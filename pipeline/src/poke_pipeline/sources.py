"""Read helpers for the `youtube_sources` table.

The Python pipeline never writes to `youtube_sources` — that's the
Next.js `/sources` page's job. We just consume the user's curated list.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from poke_pipeline.db import connection

Kind = Literal["channel", "video"]


@dataclass(frozen=True)
class Source:
    id: str
    kind: Kind
    external_id: str
    title: str | None
    backfill_max_videos: int
    backfilled_at: datetime | None


def _row_to_source(row: dict) -> Source:
    return Source(
        id=row["id"],
        kind=row["kind"],
        external_id=row["external_id"],
        title=row["title"],
        backfill_max_videos=row["backfill_max_videos"],
        backfilled_at=row["backfilled_at"],
    )


def list_active_sources() -> list[Source]:
    """Return every `active = true` source, ordered by added_at for stable
    pipeline behavior across runs.
    """
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text AS id, kind, external_id, title,
                   backfill_max_videos, backfilled_at
            FROM youtube_sources
            WHERE active = true
            ORDER BY added_at ASC
            """
        )
        return [_row_to_source(row) for row in cur.fetchall()]


def list_sources_needing_backfill() -> list[Source]:
    """Active sources that have never been backfilled. Each `backfill` run
    processes these; once `mark_backfilled` runs the source is dropped from
    this list permanently (until a human clears `backfilled_at` to re-run).
    """
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text AS id, kind, external_id, title,
                   backfill_max_videos, backfilled_at
            FROM youtube_sources
            WHERE active = true AND backfilled_at IS NULL
            ORDER BY added_at ASC
            """
        )
        return [_row_to_source(row) for row in cur.fetchall()]


def mark_backfilled(source_id: str) -> None:
    """Stamp the source so subsequent `backfill` runs skip it."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE youtube_sources SET backfilled_at = NOW() WHERE id = %s",
            (source_id,),
        )


def touch_last_discovered(source_id: str) -> None:
    """Bump `last_discovered_at` after a successful discovery pass."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE youtube_sources SET last_discovered_at = NOW() WHERE id = %s",
            (source_id,),
        )


def update_source_title(source_id: str, title: str) -> None:
    """Keep the display title fresh — channels rename, video titles change."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE youtube_sources SET title = %s WHERE id = %s",
            (title, source_id),
        )
