"""Unit tests for match_item.

`load_items_index` is a thin DB read and is skipped here; the interesting
logic is in `match_item` and the alias fan-out it does over `ItemRef`.
"""

from __future__ import annotations

from poke_pipeline.matching import ItemRef, match_item


def test_matches_by_exact_name() -> None:
    index = [ItemRef(id="i1", name="Destined Rivals Booster Bundle")]
    assert match_item("Destined Rivals Booster Bundle", index) == "i1"


def test_matches_by_close_name() -> None:
    index = [ItemRef(id="i1", name="Destined Rivals Booster Bundle")]
    # Slight rewording — WRatio handles this fine.
    assert match_item("Destined Rivals booster bundle", index) == "i1"


def test_matches_via_alias() -> None:
    index = [
        ItemRef(
            id="i1",
            name="Ascended Heroes ETB",
            aliases=("Destined Rivals ETB",),
        )
    ]
    # A mention that matches the alias, not the primary name, should still
    # resolve to i1 — this is the whole point of aliases.
    assert match_item("Destined Rivals ETB", index) == "i1"


def test_alias_wins_over_generic_name_fuzz() -> None:
    # Two items where the raw name is closer to the alias of i2 than to
    # the name of i1. Without alias support, i1 would win (or nothing);
    # with aliases, i2 wins.
    index = [
        ItemRef(id="i1", name="Perfect Order Elite Trainer Box"),
        ItemRef(
            id="i2",
            name="Prismatic Evolutions Booster Bundle",
            aliases=("Perfect Order ETB",),
        ),
    ]
    assert match_item("Perfect Order ETB", index) == "i2"


def test_below_threshold_returns_none() -> None:
    index = [ItemRef(id="i1", name="Ascended Heroes ETB")]
    # Wildly different string — no match.
    assert match_item("random unrelated string zzz", index) is None


def test_empty_inputs() -> None:
    assert match_item("", []) is None
    assert match_item("anything", []) is None
    assert match_item("", [ItemRef(id="i1", name="foo")]) is None


def test_empty_alias_strings_skipped() -> None:
    # Defensive: if a stray empty-string sneaks into the aliases tuple it
    # should not become a candidate (empty strings score badly and could
    # crash rapidfuzz depending on version).
    index = [
        ItemRef(id="i1", name="Ascended Heroes ETB", aliases=("", "Heroes ETB")),
    ]
    assert match_item("Heroes ETB", index) == "i1"
