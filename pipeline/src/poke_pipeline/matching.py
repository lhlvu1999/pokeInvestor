"""Fuzzy-match an LLM-extracted `raw_name` against the user's existing
`items` table. Best-effort — when no item is confident enough we leave
`item_id` NULL and the Next.js admin UI surfaces the row for manual
resolution.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from rapidfuzz import fuzz, process

from poke_pipeline.db import connection

# Threshold above which we accept a fuzzy match automatically. Tuned by
# eyeballing — bias toward leaving things unmatched rather than mislabeling.
AUTO_MATCH_THRESHOLD = 90


@dataclass(frozen=True)
class ItemRef:
    id: str
    name: str


def load_items_index() -> list[ItemRef]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id::text AS id, name FROM items ORDER BY name")
        return [ItemRef(id=row["id"], name=row["name"]) for row in cur.fetchall()]


def match_item(raw_name: str, index: list[ItemRef]) -> str | None:
    """Return an item id if confidence is high enough; otherwise None."""
    if not raw_name or not index:
        return None
    choices = {item.id: item.name for item in index}
    result: Any = process.extractOne(
        raw_name,
        choices,
        scorer=fuzz.WRatio,
        score_cutoff=AUTO_MATCH_THRESHOLD,
    )
    if result is None:
        return None
    # rapidfuzz returns (choice, score, key) — the third element is the dict key.
    _, _score, item_id = result
    return str(item_id)
