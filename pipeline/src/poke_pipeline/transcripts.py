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
from typing import Any

from youtube_transcript_api import (  # type: ignore[import-untyped]
    CouldNotRetrieveTranscript,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeTranscriptApi,
)

from poke_pipeline.db import connection

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TranscriptResult:
    fetched: int
    missing: int
    errored: int


def run() -> TranscriptResult:
    pending = _select_pending_videos()
    log.info("transcripts: %d pending video(s)", len(pending))

    fetched = missing = errored = 0
    for video_id in pending:
        status, payload = _fetch_one(video_id)
        _record(video_id, status, payload)
        if status == "ok":
            fetched += 1
        elif status == "missing":
            missing += 1
        else:
            errored += 1

    return TranscriptResult(fetched=fetched, missing=missing, errored=errored)


def _select_pending_videos() -> list[str]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT v.video_id
            FROM youtube_videos v
            LEFT JOIN youtube_transcripts t ON t.video_id = v.video_id
            WHERE t.video_id IS NULL
            -- Backfilled videos have published_at NULL until RSS catches
            -- them; fall back to discovered_at so they don't all sort last.
            ORDER BY COALESCE(v.published_at, v.discovered_at) DESC
            """
        )
        return [row["video_id"] for row in cur.fetchall()]


def _fetch_one(
    video_id: str,
) -> tuple[str, dict[str, Any]]:
    """Returns `(status, payload)` ready for DB insert. Status is one of
    'ok', 'missing', 'error'. Payload columns differ per status.
    """
    try:
        # Prefer English first, fall back to any available transcript.
        api = YouTubeTranscriptApi()
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
