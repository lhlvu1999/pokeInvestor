"""Phase 2 — fetch transcripts for any videos that don't have one yet.

Idempotent: only videos with no row in `youtube_transcripts` are touched.
Failures (captions disabled, video gone, network blip) are recorded as
rows with `status = 'missing' | 'error'` so subsequent runs skip them
rather than retrying forever.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from http.cookiejar import MozillaCookieJar
from pathlib import Path
from typing import Any

import requests
from youtube_transcript_api import (  # type: ignore[import-untyped]
    CouldNotRetrieveTranscript,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)
from youtube_transcript_api.proxies import GenericProxyConfig  # type: ignore[import-untyped]

from poke_pipeline.config import load_settings
from poke_pipeline.db import connection

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TranscriptResult:
    fetched: int
    missing: int
    errored: int


def build_api() -> YouTubeTranscriptApi:
    """Construct the API client with whichever workaround is configured:
    `YT_TRANSCRIPT_COOKIES` (path to Netscape cookies file) and/or
    `YT_TRANSCRIPT_PROXY` (HTTP/SOCKS URL). With neither set, the client
    runs unauthenticated and your IP is on its own against YouTube's
    block heuristics.
    """
    settings = load_settings()
    kwargs: dict[str, Any] = {}

    if settings.yt_transcript_cookies_path:
        path = Path(settings.yt_transcript_cookies_path).expanduser()
        if not path.is_file():
            log.warning(
                "YT_TRANSCRIPT_COOKIES=%s does not exist; ignoring", path
            )
        else:
            session = requests.Session()
            jar = MozillaCookieJar(str(path))
            jar.load(ignore_discard=True, ignore_expires=True)
            session.cookies = jar  # type: ignore[assignment]
            kwargs["http_client"] = session
            log.info("transcripts: loaded cookies from %s", path)

    if settings.yt_transcript_proxy_url:
        kwargs["proxy_config"] = GenericProxyConfig(
            http_url=settings.yt_transcript_proxy_url,
            https_url=settings.yt_transcript_proxy_url,
        )
        log.info(
            "transcripts: routing through proxy %s",
            _redact_proxy(settings.yt_transcript_proxy_url),
        )

    return YouTubeTranscriptApi(**kwargs)


def _redact_proxy(url: str) -> str:
    """Strip credentials from a proxy URL before logging it."""
    if "@" not in url:
        return url
    scheme, _, rest = url.partition("://")
    _, _, hostpart = rest.partition("@")
    return f"{scheme}://***:***@{hostpart}" if scheme else f"***:***@{hostpart}"


def run(retry_errors: bool = False) -> TranscriptResult:
    """Fetch transcripts for videos that don't have one yet.

    With `retry_errors=True`, also re-attempts rows previously stored as
    `status='error'` — useful after an IP-block / rate-limit episode that
    has since expired. Rows recorded as `status='missing'` are *not*
    retried (YouTube has explicitly told us captions are disabled; that
    won't change without a creator action).
    """
    pending = _select_pending_videos(retry_errors=retry_errors)
    if retry_errors:
        log.info(
            "transcripts: %d video(s) pending (including previously errored)",
            len(pending),
        )
    else:
        log.info("transcripts: %d pending video(s)", len(pending))

    # Build the API client *once* so cookies / proxy config are reused
    # across every fetch in the run (and not reconstructed 119 times).
    api = build_api()

    fetched = missing = errored = 0
    for video_id in pending:
        status, payload = _fetch_one(api, video_id)
        _record(video_id, status, payload)
        if status == "ok":
            fetched += 1
        elif status == "missing":
            missing += 1
        else:
            errored += 1

    return TranscriptResult(fetched=fetched, missing=missing, errored=errored)


def _select_pending_videos(*, retry_errors: bool) -> list[str]:
    """Videos that need a fetch attempt this run. By default that's just
    videos with no transcript row at all; with `retry_errors=True` we also
    pull rows recorded as `status='error'` (rate-limited, IP-blocked,
    transient failure). Rows stored as `status='missing'` are skipped
    in both modes — YouTube told us the video genuinely has no captions.
    """
    extra_clause = "OR t.status = 'error'" if retry_errors else ""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT v.video_id
            FROM youtube_videos v
            LEFT JOIN youtube_transcripts t ON t.video_id = v.video_id
            WHERE t.video_id IS NULL
              {extra_clause}
            -- Backfilled videos have published_at NULL until RSS catches
            -- them; fall back to discovered_at so they don't all sort last.
            ORDER BY COALESCE(v.published_at, v.discovered_at) DESC
            """
        )
        return [row["video_id"] for row in cur.fetchall()]


def _fetch_one(
    api: YouTubeTranscriptApi,
    video_id: str,
) -> tuple[str, dict[str, Any]]:
    """Returns `(status, payload)` ready for DB insert. Status is one of
    'ok', 'missing', 'error'. Payload columns differ per status.
    """
    try:
        # Prefer English first, fall back to any available transcript.
        transcript_list = api.list(video_id)
        try:
            transcript = transcript_list.find_transcript(["en", "en-US", "en-GB"])
        except NoTranscriptFound:
            # Take the first non-generated one if possible, else any.
            available = [t for t in transcript_list if not t.is_generated]
            if not available:
                available = list(transcript_list)
            if not available:
                raise
            transcript = available[0]
        fetched = transcript.fetch()
        segments: list[dict[str, Any]] = [
            {
                "text": s.text,
                "start": float(s.start),
                "duration": float(s.duration),
            }
            for s in fetched
        ]
        text = "\n".join(s["text"] for s in segments if s["text"]).strip()
        return "ok", {
            "language": transcript.language_code,
            "text": text,
            "segments_json": json.dumps(segments),
            "error_msg": None,
        }
    except TranscriptsDisabled:
        return "missing", {
            "language": None,
            "text": None,
            "segments_json": None,
            "error_msg": "captions disabled",
        }
    except NoTranscriptFound:
        return "missing", {
            "language": None,
            "text": None,
            "segments_json": None,
            "error_msg": "no transcript available",
        }
    except VideoUnavailable as exc:
        return "error", {
            "language": None,
            "text": None,
            "segments_json": None,
            "error_msg": f"video unavailable: {exc}",
        }
    except CouldNotRetrieveTranscript as exc:
        return "error", {
            "language": None,
            "text": None,
            "segments_json": None,
            "error_msg": f"transcript api error: {exc}",
        }
    except Exception as exc:
        log.exception("unexpected transcript error for %s", video_id)
        return "error", {
            "language": None,
            "text": None,
            "segments_json": None,
            "error_msg": f"unexpected: {type(exc).__name__}: {exc}",
        }


def _record(video_id: str, status: str, payload: dict[str, Any]) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO youtube_transcripts
              (video_id, language, text, segments, status, error_msg, fetched_at)
            VALUES (%s, %s, %s, %s::jsonb, %s, %s, NOW())
            ON CONFLICT (video_id) DO UPDATE
              SET language = EXCLUDED.language,
                  text = EXCLUDED.text,
                  segments = EXCLUDED.segments,
                  status = EXCLUDED.status,
                  error_msg = EXCLUDED.error_msg,
                  fetched_at = EXCLUDED.fetched_at
            """,
            (
                video_id,
                payload["language"],
                payload["text"],
                payload["segments_json"],
                status,
                payload["error_msg"],
            ),
        )
