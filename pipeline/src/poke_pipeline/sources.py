"""Read helpers for the `youtube_sources` table.

The Python pipeline never writes to `youtube_sources` — that's the
Next.js `/sources` page's job. We just consume the user's curated list.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from poke_pipeline.db import connection

Kind = Literal["channel", "video"]


@dataclass(frozen=True)
class Source:
    id: str
    kind: Kind
    external_id: str
    title: str | None


def list_active_sources() -> list[Source]:
    """Return every `active = true` source, ordered by added_at for stable
    pipeline behavior across runs.
    """
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text AS id, kind, external_id, title
            FROM youtube_sources
            WHERE active = true
            ORDER BY added_at ASC
            """
        )
        return [
            Source(
                id=row["id"],
                kind=row["kind"],
                external_id=row["external_id"],
                title=row["title"],
            )
            for row in cur.fetchall()
        ]


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
