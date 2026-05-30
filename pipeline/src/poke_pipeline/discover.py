"""Phase 1 — discover videos for every active source.

For channels we use the public RSS feed
`https://www.youtube.com/feeds/videos.xml?channel_id=…` — no API key, ~15
latest entries.

For single-video sources we scrape minimal metadata from the watch page
(title, channelId, channelTitle, published). Brittle but key-free; if
YouTube changes the markup we record an error and skip rather than crash
the whole run.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import feedparser
import httpx

from poke_pipeline import sources as src_repo
from poke_pipeline.config import load_settings
from poke_pipeline.db import connection

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class DiscoverResult:
    sources_checked: int
    videos_added: int


def run() -> DiscoverResult:
    settings = load_settings()
    sources = src_repo.list_active_sources()
    log.info("discover: %d active source(s)", len(sources))

    total_added = 0
    for source in sources:
        try:
            if source.kind == "channel":
                added = _discover_channel(source, settings.discover_max_per_source)
            else:
                added = _discover_single_video(source)
            total_added += added
            src_repo.touch_last_discovered(source.id)
        except Exception:
            # One bad source must not abort the whole pass.
            log.exception("discover failed for source %s (%s)", source.id, source.kind)

    return DiscoverResult(sources_checked=len(sources), videos_added=total_added)


# ─── channel via RSS ────────────────────────────────────────────────────────


_CHANNEL_RSS = "https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"


def _discover_channel(source: src_repo.Source, max_per_source: int) -> int:
    feed = feedparser.parse(_CHANNEL_RSS.format(channel_id=source.external_id))
    if feed.bozo and not feed.entries:
        log.warning(
            "RSS parse failed for channel %s: %s",
            source.external_id,
            getattr(feed, "bozo_exception", "unknown"),
        )
        return 0

    channel_title: str | None = getattr(feed.feed, "title", None)
    if channel_title:
        src_repo.update_source_title(source.id, channel_title)

    entries = feed.entries[:max_per_source]
    log.debug("channel %s: %d RSS entries", source.external_id, len(entries))

    added = 0
    for entry in entries:
        video_id = _extract_video_id(entry)
        if not video_id:
            continue
        published_at = _parse_published(entry)
        if published_at is None:
            continue
        if upsert_video(
            video_id=video_id,
            source_id=source.id,
            title=getattr(entry, "title", "") or "",
            channel_id=source.external_id,
            channel_title=channel_title,
            published_at=published_at,
        ):
            added += 1
    return added


def _extract_video_id(entry: Any) -> str | None:
    # feedparser exposes <yt:videoId> as `entry.yt_videoid`.
    vid = getattr(entry, "yt_videoid", None)
    if vid:
        return str(vid)
    link = getattr(entry, "link", None)
    if isinstance(link, str):
        m = re.search(r"[?&]v=([0-9A-Za-z_-]{11})", link)
        if m:
            return m.group(1)
    return None


def _parse_published(entry: Any) -> datetime | None:
    parsed = getattr(entry, "published_parsed", None)
    if parsed is None:
        return None
    return datetime(*parsed[:6], tzinfo=UTC)


# ─── single video via page scrape ───────────────────────────────────────────


_VIDEO_PAGE = "https://www.youtube.com/watch?v={video_id}"

# YouTube serves variant HTML — try several patterns. Canonical link tag
# first (most stable), then JSON blobs as fallback.
_CHANNEL_ID_PATTERNS = [
    re.compile(
        r'<link itemprop="channelId" content="(UC[0-9A-Za-z_-]{22})"'
    ),
    re.compile(r'"externalChannelId":"(UC[0-9A-Za-z_-]{22})"'),
    re.compile(r'"externalId":"(UC[0-9A-Za-z_-]{22})"'),
    re.compile(r'"channelId":"(UC[0-9A-Za-z_-]{22})"'),
    re.compile(r'"browseId":"(UC[0-9A-Za-z_-]{22})"'),
]
_CHANNEL_NAME_RE = re.compile(r'"ownerChannelName":"([^"]+)"')
_TITLE_RE = re.compile(r'<meta name="title" content="([^"]+)"')
# Published is usually in a deeply-nested JSON blob; fall back to upload date.
_UPLOAD_DATE_RE = re.compile(r'"uploadDate":"([^"]+)"')
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)


def _extract_channel_id(html: str) -> str | None:
    for pattern in _CHANNEL_ID_PATTERNS:
        match = pattern.search(html)
        if match:
            return match.group(1)
    return None


def _discover_single_video(source: src_repo.Source) -> int:
    settings = load_settings()
    url = _VIDEO_PAGE.format(video_id=source.external_id)
    try:
        resp = httpx.get(
            url,
            headers={"user-agent": _USER_AGENT, "accept-language": "en-US,en;q=0.9"},
            timeout=settings.request_timeout_sec,
            follow_redirects=True,
        )
    except httpx.HTTPError as exc:
        log.warning("video page fetch failed for %s: %s", source.external_id, exc)
        return 0
    if resp.status_code != 200:
        log.warning("video page HTTP %s for %s", resp.status_code, source.external_id)
        return 0

    html = resp.text
    channel_id = _extract_channel_id(html)
    title_match = _TITLE_RE.search(html)
    if not channel_id or not title_match:
        log.warning("could not parse video page for %s", source.external_id)
        return 0

    name_match = _CHANNEL_NAME_RE.search(html)
    upload_match = _UPLOAD_DATE_RE.search(html)
    published_at = _safe_iso(upload_match.group(1)) if upload_match else None
    if published_at is None:
        # Fallback: we'd rather record "now" than skip; the field is required.
        published_at = datetime.now(tz=UTC)

    inserted = upsert_video(
        video_id=source.external_id,
        source_id=source.id,
        title=title_match.group(1),
        channel_id=channel_id,
        channel_title=name_match.group(1) if name_match else None,
        published_at=published_at,
    )

    # Single-video sources display the video title.
    src_repo.update_source_title(source.id, title_match.group(1))

    return 1 if inserted else 0


def _safe_iso(value: str) -> datetime | None:
    try:
        # YouTube returns e.g. "2024-08-15T00:00:00-07:00"
        return datetime.fromisoformat(value)
    except ValueError:
        return None


# ─── upsert ─────────────────────────────────────────────────────────────────


def upsert_video(
    *,
    video_id: str,
    source_id: str,
    title: str,
    channel_id: str,
    channel_title: str | None,
    published_at: datetime | None,
) -> bool:
    """Insert a video if it's new; otherwise refresh title/source attribution.
    Returns True iff the row didn't previously exist.
    """
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO youtube_videos
              (video_id, source_id, title, channel_id, channel_title, published_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (video_id) DO UPDATE
              SET
                  -- Title rule: RSS data is authoritative (always current);
                  -- yt-dlp flat extract sometimes serves stale titles from
                  -- YouTube's cached channel-listing page. So: only let the
                  -- incoming title win when *either* the new row also has a
                  -- date (i.e. this is an RSS-driven upsert, the freshest
                  -- source) *or* the existing row has no date (i.e. it was
                  -- only ever touched by backfill, no risk of overwriting
                  -- RSS data with stale data).
                  title = CASE
                    WHEN EXCLUDED.published_at IS NOT NULL THEN EXCLUDED.title
                    WHEN youtube_videos.published_at IS NULL THEN EXCLUDED.title
                    ELSE youtube_videos.title
                  END,
                  channel_title = COALESCE(EXCLUDED.channel_title,
                                           youtube_videos.channel_title),
                  source_id = COALESCE(youtube_videos.source_id,
                                       EXCLUDED.source_id),
                  -- Don't overwrite a real date with NULL: backfill goes
                  -- first with no date, then a later RSS discover fills it.
                  published_at = COALESCE(EXCLUDED.published_at,
                                          youtube_videos.published_at)
            RETURNING (xmax = 0) AS inserted
            """,
            (video_id, source_id, title, channel_id, channel_title, published_at),
        )
        row = cur.fetchone()
        return bool(row and row["inserted"])
