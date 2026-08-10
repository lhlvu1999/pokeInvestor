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
    # Alternate names the user has taught the matcher via the item-detail
    # AliasEditor. Tried as candidates alongside `name` so a mention that
    # matches an alias resolves to this item's id.
    aliases: tuple[str, ...] = ()


def load_items_index() -> list[ItemRef]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id::text AS id, name, coalesce(aliases, '{}'::text[]) AS aliases "
            "FROM items ORDER BY name"
        )
        return [
            ItemRef(
                id=row["id"],
                name=row["name"],
                aliases=tuple(row["aliases"] or ()),
            )
            for row in cur.fetchall()
        ]


def match_item(raw_name: str, index: list[ItemRef]) -> str | None:
    """Return an item id if confidence is high enough; otherwise None.

    Candidates include each item's `name` plus every alias the user has
    added — all keyed back to the parent item's id so an alias hit
    resolves the same as a name hit.
    """
    if not raw_name or not index:
        return None
    # Unique per-candidate keys (id::0 = name, id::1..N = aliases) mapped
    # to the string rapidfuzz scores against. We map back to `item.id` from
    # the winning key.
    choices: dict[str, str] = {}
    key_to_id: dict[str, str] = {}
    for item in index:
        name_key = f"{item.id}::0"
        choices[name_key] = item.name
        key_to_id[name_key] = item.id
        for i, alias in enumerate(item.aliases, start=1):
            if not alias:
                continue
            alias_key = f"{item.id}::{i}"
            choices[alias_key] = alias
            key_to_id[alias_key] = item.id
    result: Any = process.extractOne(
        raw_name,
        choices,
        scorer=fuzz.WRatio,
        score_cutoff=AUTO_MATCH_THRESHOLD,
    )
    if result is None:
        return None
    # rapidfuzz returns (choice, score, key) — the third element is the dict key.
    _, _score, key = result
    return key_to_id[str(key)]
