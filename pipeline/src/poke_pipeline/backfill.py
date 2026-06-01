"""Phase 0 — one-shot historical backfill for newly-added channels.

Two depth modes per source (`youtube_sources.backfill_mode`):

* **`count`** — flat channel-listing extract returns the N newest video
  IDs in a single HTTP. Fast, no auth, no per-video calls; the trade-off
  is that flat extract doesn't expose `upload_date` so backfilled rows
  go in with `published_at = NULL`. Use this when you just want "the
  last 100 videos, whatever they are".

* **`days`** — same flat list to get IDs in newest-first order, then a
  per-video extract for each one to read `upload_date`, stopping at the
  cutoff. Uses a multi-client player fallback
  (`tv_embedded → android → mediaconnect`) to dodge YouTube's anti-bot
  wall — which is intermittent rather than constant. Slower (~1s/video)
  and best-effort: videos whose extract fails get skipped (can't enforce
  a date filter without a date). Still capped by `backfill_max_videos`
  as a safety net.

After backfill completes (success or partial), `backfilled_at` is set so
the source isn't re-processed on subsequent runs. To re-backfill, clear
`backfilled_at = NULL` (the `/sources` edit UI does this when settings
change).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from yt_dlp import YoutubeDL  # type: ignore[import-untyped]

from poke_pipeline import sources as src_repo
from poke_pipeline.discover import upsert_video

log = logging.getLogger(__name__)


# Hard ceiling on per-video extracts regardless of source settings. Protects
# against a configuration error pointing us at a huge channel.
_ABSOLUTE_MAX_VIDEOS = 1000

# Player clients that historically work around YouTube's bot wall. Listed in
# preference order — yt-dlp tries each and uses the first that succeeds.
_PLAYER_CLIENT_FALLBACK = ["tv_embedded", "android", "mediaconnect"]


@dataclass(frozen=True)
class BackfillResult:
    sources_processed: int
    sources_failed: int
    videos_added: int


def run() -> BackfillResult:
    pending = src_repo.list_sources_needing_backfill()
    log.info("backfill: %d source(s) pending", len(pending))

    processed = failed = added = 0
    for source in pending:
        if source.kind != "channel":
            # Single-video sources: nothing to backfill; discover handles them.
            src_repo.mark_backfilled(source.id)
            processed += 1
            continue
        try:
            count = _backfill_channel(source)
            src_repo.mark_backfilled(source.id)
            processed += 1
            added += count
            log.info(
                "backfill: %s (%s, mode=%s) — %d video(s) added",
                source.title or source.external_id,
                source.external_id,
                source.backfill_mode,
                count,
            )
        except Exception:
            failed += 1
            log.exception(
                "backfill failed for source %s (%s)",
                source.id,
                source.external_id,
            )

    return BackfillResult(
        sources_processed=processed,
        sources_failed=failed,
        videos_added=added,
    )


# ─── per-source dispatch ────────────────────────────────────────────────────


def _backfill_channel(source: src_repo.Source) -> int:
    if source.backfill_mode == "days":
        return _backfill_by_days(source)
    return _backfill_by_count(source)


# ─── count mode (fast, no dates) ────────────────────────────────────────────


def _backfill_by_count(source: src_repo.Source) -> int:
    """One HTTP, no per-video calls. Upserts the first N entries with
    `published_at = NULL` — discover later fills the dates for the
    most-recent 15 via RSS.
    """
    cap = min(source.backfill_max_videos, _ABSOLUTE_MAX_VIDEOS)
    channel_title, entries = _list_channel_videos(source.external_id, cap=cap)

    added = 0
    for entry in entries:
        video_id = _extract_video_id(entry)
        if video_id is None:
            continue
        inserted = upsert_video(
            video_id=video_id,
            source_id=source.id,
            title=str(entry.get("title") or ""),
            channel_id=source.external_id,
            channel_title=channel_title,
            published_at=None,
            duration_sec=_coerce_duration(entry.get("duration")),
        )
        if inserted:
            added += 1
    return added


# ─── days mode (best-effort, with dates) ────────────────────────────────────


def _backfill_by_days(source: src_repo.Source) -> int:
    """Iterate the channel's flat list newest-first, do a per-video extract
    for each, stop when we cross the cutoff.

    `backfill_max_videos` is the safety cap so a channel with thousands of
    daily uploads can't trigger thousands of per-video HTTPs.

    A per-video extract may fail (bot wall, deleted video, age-restricted).
    Failures don't abort the run — we skip the video and continue. The
    rationale: we cannot enforce a date cutoff for videos whose date we
    couldn't read, so silently saving them would mean lying about the
    "last N days" promise. Skipping is the honest choice.
    """
    cap = min(source.backfill_max_videos, _ABSOLUTE_MAX_VIDEOS)
    cutoff = datetime.now(tz=UTC) - timedelta(days=source.backfill_days)
    cutoff_yyyymmdd = cutoff.strftime("%Y%m%d")

    flat_channel_title, flat_entries = _list_channel_videos(
        source.external_id, cap=cap
    )
    if not flat_entries:
        return 0

    per_opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignoreerrors": True,
        "extractor_args": {
            "youtube": {
                "player_client": list(_PLAYER_CLIENT_FALLBACK),
                "player_skip": ["webpage", "configs"],
            },
        },
    }

    added = 0
    consecutive_failures = 0
    with YoutubeDL(per_opts) as ydl:
        for entry in flat_entries:
            video_id = _extract_video_id(entry)
            if video_id is None:
                continue

            info: dict[str, Any] | None
            try:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}",
                    download=False,
                )
            except Exception as exc:
                log.debug(
                    "skip %s: per-video extract failed (%s)",
                    video_id,
                    exc,
                )
                info = None

            if not isinstance(info, dict):
                consecutive_failures += 1
                # Bail early when the bot wall clamps us hard — every
                # subsequent video would also fail. Better to mark the
                # source backfilled-partial than spin uselessly.
                if consecutive_failures >= 5:
                    log.warning(
                        "stopping backfill for %s: 5 consecutive extract "
                        "failures, likely rate-limited",
                        source.external_id,
                    )
                    break
                continue
            consecutive_failures = 0

            upload_date = info.get("upload_date")
            if not isinstance(upload_date, str):
                # Some clients return videos without a publish date.
                continue
            if upload_date < cutoff_yyyymmdd:
                # Flat list is newest-first, so we've crossed the cutoff.
                # Everything after this is older — we're done.
                break

            published_at = _parse_upload_date(upload_date)
            inserted = upsert_video(
                video_id=video_id,
                source_id=source.id,
                title=str(info.get("title") or entry.get("title") or ""),
                channel_id=source.external_id,
                # Per-video extract may not surface channel/uploader on some
                # clients (esp. tv_embedded), so fall back to the channel-page
                # name we captured from the flat list.
                channel_title=(
                    info.get("channel")
                    or info.get("uploader")
                    or flat_channel_title
                ),
                published_at=published_at,
                # Duration is reliably in flat entries; the per-video extract
                # also returns it. Prefer the more recent (per-video) but fall
                # back to flat.
                duration_sec=(
                    _coerce_duration(info.get("duration"))
                    or _coerce_duration(entry.get("duration"))
                ),
            )
            if inserted:
                added += 1

    return added


# ─── helpers ────────────────────────────────────────────────────────────────


def _list_channel_videos(
    channel_id: str, *, cap: int
) -> tuple[str | None, list[dict[str, Any]]]:
    """Single-HTTP flat enumeration of a channel's video tab.

    Returns `(channel_title, entries)` — yt-dlp surfaces the channel's
    display name at the top-level info dict (`info["channel"]` or
    `info["uploader"]`), so we capture it here and let callers pass it
    through to `upsert_video`. Without this, newly-backfilled rows that
    never re-appear in RSS keep `channel_title = NULL` forever.

    Failure modes:
      - Channel not found / private: yt-dlp raises. Caller logs and moves on.
      - YouTube changed markup: yt-dlp raises; `uv sync --upgrade yt-dlp`.
    """
    url = f"https://www.youtube.com/channel/{channel_id}/videos"
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignoreerrors": True,
        # `extract_flat='in_playlist'` is the bit that skips per-video
        # extraction, so we get IDs + titles without triggering the bot wall.
        "extract_flat": "in_playlist",
        "playlistend": cap,
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not isinstance(info, dict):
        return None, []
    channel_title_raw = info.get("channel") or info.get("uploader")
    channel_title = (
        channel_title_raw if isinstance(channel_title_raw, str) else None
    )
    entries = info.get("entries")
    if not isinstance(entries, list):
        return channel_title, []
    return channel_title, [e for e in entries if isinstance(e, dict)]


def _extract_video_id(entry: dict[str, Any]) -> str | None:
    vid = entry.get("id")
    if isinstance(vid, str) and len(vid) == 11:
        return vid
    return None


def _coerce_duration(value: Any) -> int | None:
    """yt-dlp returns `duration` as a float (seconds), sometimes None for
    live or scheduled videos. Coerce to integer seconds; return None for
    missing or non-numeric input.
    """
    if value is None:
        return None
    try:
        secs = int(float(value))
    except (TypeError, ValueError):
        return None
    return secs if secs > 0 else None


def _parse_upload_date(yyyymmdd: str) -> datetime | None:
    """yt-dlp's `upload_date` is `YYYYMMDD` in UTC."""
    if len(yyyymmdd) != 8 or not yyyymmdd.isdigit():
        return None
    try:
        return datetime(
            year=int(yyyymmdd[0:4]),
            month=int(yyyymmdd[4:6]),
            day=int(yyyymmdd[6:8]),
            tzinfo=UTC,
        )
    except ValueError:
        return None
