import json
from pathlib import Path

import pytest

from poke_pipeline.set_tags import MAX_TAGS_PER_ITEM, set_tag_name, tag_item_with_set

VECTORS = json.loads(
    (Path(__file__).parent / "fixtures" / "set_tag_vectors.json").read_text()
)["cases"]


def test_vectors_are_substantial():
    assert len(VECTORS) >= 15
    assert any(v["tag"] is None for v in VECTORS)  # the "too long / empty" cases are covered


@pytest.mark.parametrize("v", VECTORS, ids=[f"{v['name']!r}-{v['language']}" for v in VECTORS])
def test_matches_the_app(v):
    assert set_tag_name(v["name"], v["language"]) == v["tag"]


class _Cur:
    """Answers the set lookup, records the update."""

    def __init__(self, set_row, rowcount=1):
        self.set_row = set_row
        self.updates: list[tuple] = []
        self.rowcount = rowcount
        self._row = None

    def execute(self, sql, params=None):
        if "FROM catalog_products" in sql:
            self._row = self.set_row
        else:
            self.updates.append((sql, params))

    def fetchone(self):
        return self._row


def test_adds_the_set_tag_once_and_never_beyond_the_limit():
    cur = _Cur({"name": "ME: Ascended Heroes", "language": "en"})
    assert tag_item_with_set(cur, "00000000-0000-4000-8000-000000000001", 1) is True
    sql, params = cur.updates[0]
    assert params[0] == "ascended heroes" and params[2] == "ascended heroes"
    assert params[3] == MAX_TAGS_PER_ITEM
    assert "NOT (%s = ANY(tags))" in sql and "cardinality(tags) < %s" in sql


def test_nothing_happens_for_an_unknown_product_or_an_unusable_name():
    assert tag_item_with_set(_Cur(None), "x", 1) is False
    assert tag_item_with_set(_Cur({"name": "SV: ", "language": "en"}), "x", 1) is False
    assert tag_item_with_set(_Cur({"name": "SV: " + "word " * 20, "language": "en"}), "x", 1) is False


def test_reports_false_when_the_item_already_had_the_tag_or_was_full():
    assert tag_item_with_set(_Cur({"name": "ME: Ascended Heroes", "language": "en"}, rowcount=0), "x", 1) is False
