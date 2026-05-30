"""Phase 0 — one-shot historical backfill for newly-added channels.

The default `discover` phase uses YouTube's public RSS feed, which only
exposes the ~15 most recent uploads per channel. For a daily-uploading
channel that's two weeks of history; older videos are unreachable via
RSS.

`backfill` fills the gap with **yt-dlp flat channel-listing extraction**:
a single HTTP call to `https://www.youtube.com/channel/<id>/videos` that
returns up to `backfill_max_videos` video IDs (newest first), each with a
title and duration. We *don't* fetch per-video metadata, which is what
trips YouTube's anti-bot wall.

Trade-off: flat extract doesn't expose `upload_date`. Backfilled rows go
in with `published_at = NULL` — `discover` later sets that column when
the video re-appears in the channel's RSS feed (if recent enough). For
backfilled-but-never-rediscovered rows, downstream queries sort with
`COALESCE(published_at, discovered_at)`.

Why this design over alternatives:
  * Date-range filtering ("last 180 days") needs per-video extracts →
    blocked by YouTube's bot wall as of 2026-05.
  * Cookie-based auth bypasses the wall but is brittle and doesn't
    survive in k8s without secret rotation.
  * YouTube Data API v3 is rock-solid but requires a Google Cloud key.

If you later need accurate dates, the right move is to add the Data API
as an optional alternative, gated on `YOUTUBE_API_KEY` being present.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from yt_dlp import YoutubeDL  # type: ignore[import-untyped]

from poke_pipeline import sources as src_repo
from poke_pipeline.discover import upsert_video

log = logging.getLogger(__name__)


# Hard ceiling regardless of per-source `backfill_max_videos`. Flat extract
# of 1000 entries is one ~5 second HTTP request, so this is generous.
_ABSOLUTE_MAX_VIDEOS = 1000


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
            # Single-video sources: nothing to backfill; discover handles it.
            src_repo.mark_backfilled(source.id)
            processed += 1
            continue
        try:
            count = _backfill_channel(source)
            src_repo.mark_backfilled(source.id)
            processed += 1
            added += count
            log.info(
                "backfill: %s (%s) — %d video(s) added",
                source.title or source.external_id,
                source.external_id,
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


# ─── per-source ─────────────────────────────────────────────────────────────


def _backfill_channel(source: src_repo.Source) -> int:
    """Walk the channel's `/videos` page via yt-dlp's flat extraction,
    upserting the first N entries. Returns count of *new* rows inserted
    (existing rows are updated but not counted).
    """
    cap = min(source.backfill_max_videos, _ABSOLUTE_MAX_VIDEOS)
    entries = _list_channel_videos(source.external_id, cap=cap)

    added = 0
    for entry in entries:
        video_id = entry.get("id")
        if not isinstance(video_id, str) or len(video_id) != 11:
            continue
        # `published_at` is None — flat extract doesn't give us upload dates.
        # `channel_title` likewise isn't available here; discover will fill
        # it in when the video re-appears in RSS.
        inserted = upsert_video(
            video_id=video_id,
            source_id=source.id,
            title=str(entry.get("title") or ""),
            channel_id=source.external_id,
            channel_title=None,
            published_at=None,
        )
        if inserted:
            added += 1

    return added


def _list_channel_videos(channel_id: str, *, cap: int) -> list[dict[str, Any]]:
    """Single-HTTP flat enumeration of a channel's video tab.

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
        return []
    entries = info.get("entries")
    if not isinstance(entries, list):
        return []
    return [e for e in entries if isinstance(e, dict)]
