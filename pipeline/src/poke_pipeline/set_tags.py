"""Give an item its catalogue set's name as a tag, the moment it is linked.

The tag is the set's name without its code prefix, lower-case ("ME: Ascended
Heroes" -> "ascended heroes"), with " (jp)" added for Japanese sets. It mirrors
``setTagName`` in ``src/lib/calc/set_tags.ts``; both are tested against
``tests/fixtures/set_tag_vectors.json``.

Only items linked in this run are tagged, never everything every day, so a tag
you remove stays removed. An item that already carries 12 tags is left alone.
"""

from __future__ import annotations

import re
from typing import Any

MAX_TAG_LENGTH = 40
MAX_TAGS_PER_ITEM = 12

# A code prefix is letters/digits (and maybe a dash) before the first colon:
# "SV8a:", "ME02:", "S-P:". Only the first one goes.
_PREFIX = re.compile(r"^\s*[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?\s*:\s*", re.ASCII)


def set_tag_name(name: str, language: str) -> str | None:
    base = " ".join(_PREFIX.sub("", name, count=1).split()).lower()
    if not base:
        return None
    tag = f"{base} (jp)" if language == "ja" else base
    return tag if len(tag) <= MAX_TAG_LENGTH else None


def tag_item_with_set(cur: Any, item_id: str, product_id: int) -> bool:
    """Add the set tag of ``product_id`` to the item. True if a tag was added."""
    cur.execute(
        """
        SELECT s.name, s.language FROM catalog_products p
          JOIN catalog_sets s ON s.group_id = p.group_id
         WHERE p.product_id = %s
        """,
        (product_id,),
    )
    row = cur.fetchone()
    if row is None:
        return False
    tag = set_tag_name(row["name"], row["language"])
    if tag is None:
        return False
    cur.execute(
        """
        UPDATE items SET tags = array_append(tags, %s)
         WHERE id = %s::uuid AND NOT (%s = ANY(tags)) AND cardinality(tags) < %s
        """,
        (tag, item_id, tag, MAX_TAGS_PER_ITEM),
    )
    return bool(cur.rowcount)
