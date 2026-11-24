"""Tests for linking held items to the catalogue.

The matcher is a port of the web app's TypeScript one, so most of the weight is
on the SHARED vectors: both test suites read `fixtures/match_vectors.json`, which
was generated from the TypeScript implementation. If the two ever drift apart,
one of the two suites fails.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from poke_pipeline import catalog_link as cl
from poke_pipeline.catalog_link import Candidate, Match

VECTORS = json.loads((Path(__file__).parent / "fixtures" / "match_vectors.json").read_text())
CATALOG = cl.prepare_catalog(
    Candidate(product_id=c["id"], name=c["name"], set_name=c["set"]) for c in VECTORS["catalog"]
)


# ── parity with the TypeScript matcher ─────────────────────────────────────


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["item"][:40] or "<empty>")
def test_matches_the_typescript_matcher_on_the_shared_vectors(case: dict[str, object]) -> None:
    got = cl.match_item(str(case["item"]), case["tags"], CATALOG)  # type: ignore[arg-type]
    assert got.status == case["status"]
    expected = case["options"]
    assert [o[0].product_id for o in got.options] == [o["productId"] for o in expected]  # type: ignore[union-attr, index]
    for (_, score), exp in zip(got.options, expected, strict=True):  # type: ignore[arg-type]
        assert score == pytest.approx(exp["score"], abs=1e-8)  # type: ignore[index]


def test_the_vectors_exercise_every_status() -> None:
    seen = {c["status"] for c in VECTORS["cases"]}
    assert seen == {"confident", "ambiguous", "probable", "weak", "none", "not_sealed"}


# ── tokens ─────────────────────────────────────────────────────────────────


def test_tokens_expand_etb_and_blister_and_drop_pack_counts() -> None:
    assert cl.tokens("The Pokémon TCG: Black Bolt ETB!") == [
        "black",
        "bolt",
        "elite",
        "trainer",
        "box",
    ]
    assert cl.tokens("Prismatic Evolutions 2Blister [Eevee]") == [
        "prismatic",
        "evolutions",
        "2",
        "pack",
        "blister",
        "eevee",
    ]
    assert cl.tokens("Chaos Rising Booster Box 36 packs") == ["chaos", "rising", "booster", "box"]
    assert cl.tokens("") == [] and cl.tokens("***") == []


# Expected values were produced by the TypeScript `tokens` (see the matching
# test in src/lib/calc/catalog_match.test.ts), so the two cannot disagree on
# accents, full-width letters or ASCII-only word boundaries.
JS_TOKEN_CASES = [
    ("ßetb", ["elite", "trainer", "box"]),
    ("étb", ["elite", "trainer", "box"]),
    ("pokémon etb", ["elite", "trainer", "box"]),
    ("etb\u2013box", ["elite", "trainer", "box", "box"]),  # en dash
    ("\uff25\uff34\uff22", ["elite", "trainer", "box"]),  # full-width ETB
    ("x7etb", ["x7etb"]),
]


@pytest.mark.parametrize(("text", "expected"), JS_TOKEN_CASES)
def test_tokens_agree_with_javascript_on_tricky_text(text: str, expected: list[str]) -> None:
    assert cl.tokens(text) == expected


@pytest.mark.parametrize(
    ("name", "tags", "sealed"),
    [
        ("slab psa 10 Charizard ex 349/190 jp", [], False),
        ("psa 10 Pikachu", [], False),
        ("Charizard PSA 9", [], False),
        ("promo Mimikyu 075", [], False),
        ("Anything", ["slab"], False),
        ("Black Bolt Elite Trainer Box", [], True),
        ("Psyduck tin", [], True),
    ],
)
def test_is_sealed_candidate(name: str, tags: list[str], sealed: bool) -> None:
    assert cl.is_sealed_candidate(name, tags) is sealed


# ── price sanity ───────────────────────────────────────────────────────────


def test_price_sanity() -> None:
    assert cl.price_sanity(100, 120) == "ok"
    assert cl.price_sanity(100, 50) == "ok"
    assert cl.price_sanity(100, 200) == "ok"
    assert cl.price_sanity(33, 283) == "differs"
    assert cl.price_sanity(1500, 100) == "differs"
    for a, b in ((None, 100), (100, None), (0, 100), (100, 0)):
        assert cl.price_sanity(a, b) == "unknown"


def test_item_usd_cents_converts_with_the_stored_rate() -> None:
    rates = {"VND": 25_000.0, "EUR": 0.9}
    assert cl.item_usd_cents(2_500_000, "VND", rates) == 10_000  # ₫2.5M at 25,000/USD = $100
    assert cl.item_usd_cents(9_000, "EUR", rates) == 10_000  # €90 at 0.9/USD = $100
    assert cl.item_usd_cents(12_345, "USD", rates) == 12_345
    assert cl.item_usd_cents(5000, "GBP", rates) is None  # no rate stored
    assert cl.item_usd_cents(None, "VND", rates) is None
    assert cl.item_usd_cents(0, "VND", rates) is None
    assert cl.item_usd_cents(5000, "VND", {"VND": 0.0}) is None


# ── the decision ───────────────────────────────────────────────────────────


def cand(pid: int, cents: int | None) -> Candidate:
    return Candidate(pid, f"Product {pid}", "Set", cents)


def conf(c: Candidate) -> Match:
    return Match("confident", [(c, 1.0)])


def test_links_a_confident_match_whose_price_agrees() -> None:
    c = cand(1, 10_000)
    assert cl.decide_auto_link(conf(c), 11_000) is c


def test_links_a_confident_match_when_a_price_is_unknown() -> None:
    c = cand(1, None)
    assert cl.decide_auto_link(conf(c), 11_000) is c
    assert cl.decide_auto_link(conf(cand(2, 5000)), None) is not None


def test_leaves_a_confident_match_alone_when_the_prices_are_far_apart() -> None:
    # A box matched to its case: $33 vs $283.
    assert cl.decide_auto_link(conf(cand(1, 28_300)), 3_300) is None


@pytest.mark.parametrize("status", ["ambiguous", "probable", "weak", "none", "not_sealed"])
def test_never_links_anything_less_than_confident(status: str) -> None:
    assert cl.decide_auto_link(Match(status, [(cand(1, 100), 0.9)]), 100) is None


def test_a_confident_match_with_no_options_is_not_linked() -> None:
    assert cl.decide_auto_link(Match("confident", []), 100) is None


# ── link_stock with a stubbed database ─────────────────────────────────────


class Cur:
    """Answers the three SELECTs in order and records the UPDATEs."""

    def __init__(self, catalog: list[dict[str, object]], fx: list[dict[str, object]], held: list[dict[str, object]]) -> None:
        self._answers = [catalog, fx, held]
        self._current: list[dict[str, object]] = []
        self.updates: list[tuple[str, tuple[object, ...] | None]] = []
        self.rowcount = 3
        self._row: dict[str, object] | None = None

    def fetchone(self) -> dict[str, object] | None:
        return self._row

    def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
        if "WHERE p.product_id = %s" in sql:
            # The set lookup made when an item is newly linked (for its set tag).
            self._row = {"name": "SV: Black Bolt", "language": "en"}
        elif sql.lstrip().upper().startswith("SELECT"):
            self._current = self._answers.pop(0)
        else:
            self.updates.append((" ".join(sql.split()), params))

    def fetchall(self) -> list[dict[str, object]]:
        return self._current

    def __enter__(self) -> Cur:
        return self

    def __exit__(self, *a: object) -> None:
        return None


class Conn:
    def __init__(self, cur: Cur) -> None:
        self._cur = cur

    def cursor(self) -> Cur:
        return self._cur

    def __enter__(self) -> Conn:
        return self

    def __exit__(self, *a: object) -> None:
        return None


def run_with(monkeypatch: pytest.MonkeyPatch, held: list[dict[str, object]], dry_run: bool = False):
    catalog_rows = [
        {"product_id": 1, "name": "Black Bolt Elite Trainer Box", "set_name": "SV: Black Bolt", "image_url": "https://img/1.jpg", "market_cents": 15_000},
        {"product_id": 2, "name": "Black Bolt Elite Trainer Box Case", "set_name": "SV: Black Bolt", "image_url": None, "market_cents": 120_000},
        {"product_id": 3, "name": "Ascended Heroes Mini Tin [Pikachu]", "set_name": "ME: Ascended Heroes", "image_url": None, "market_cents": 3_000},
        {"product_id": 4, "name": "Ascended Heroes Mini Tin [Riolu]", "set_name": "ME: Ascended Heroes", "image_url": None, "market_cents": 3_000},
    ]
    cur = Cur(catalog_rows, [{"quote": "VND", "rate": 25_000.0}], held)
    monkeypatch.setattr(cl, "connection", lambda: Conn(cur))
    return cl.link_stock(dry_run=dry_run), cur


def held(
    id_: str,
    name: str,
    price: int | None = 3_750_000,
    tags: list[str] | None = None,
    image: str | None = None,
) -> dict[str, object]:
    return {
        "id": id_,
        "name": name,
        "tags": tags or [],
        "price": price,
        "currency": "VND" if price else None,
        "image_url": image,
    }


def test_link_stock_links_the_clear_one_and_leaves_the_rest(monkeypatch: pytest.MonkeyPatch) -> None:
    result, cur = run_with(
        monkeypatch,
        [
            held("a", "Black Bolt Elite Trainer Box"),  # confident, $150 vs $150
            held("b", "Ascended Heroes Mini Tin"),  # ambiguous tins
            held("c", "slab psa 10 Charizard"),  # not sealed: not counted
        ],
    )
    assert result.considered == 3
    assert result.linked == [("Black Bolt Elite Trainer Box", "Black Bolt Elite Trainer Box")]
    assert result.left_for_review == 1
    link_updates = [u for u in cur.updates if "catalog_link_source = 'auto'" in u[0]]
    assert len(link_updates) == 1
    assert link_updates[0][1] == (1, "https://img/1.jpg", "a")
    # A newly linked item is given its set's name as a tag, once.
    tag_updates = [u for u in cur.updates if "array_append(tags" in u[0]]
    assert [u[1][0] for u in tag_updates] == ["black bolt"]
    assert tag_updates[0][1][1] == "a"
    # one filled while linking (it had no image) + 3 reported by the catch-all fill
    assert result.images_filled == 1 + 3


def test_the_link_statement_refuses_to_override_a_persons_choice(monkeypatch: pytest.MonkeyPatch) -> None:
    _, cur = run_with(monkeypatch, [held("a", "Black Bolt Elite Trainer Box")])
    sql = next(u[0] for u in cur.updates if "catalog_link_source = 'auto'" in u[0])
    for guard in (
        "catalog_product_id IS NULL",
        "catalog_link_skipped = false",
        "catalog_link_source IS NULL",
    ):
        assert guard in sql


def test_the_image_fill_only_touches_items_with_no_image(monkeypatch: pytest.MonkeyPatch) -> None:
    _, cur = run_with(monkeypatch, [])
    fill = next(u[0] for u in cur.updates if "SET image_url = p.image_url" in u[0])
    assert "COALESCE(i.image_url, '') = ''" in fill
    assert "COALESCE(p.image_url, '') <> ''" in fill


def test_a_price_far_from_the_catalogue_sends_it_to_review_not_to_a_link(monkeypatch: pytest.MonkeyPatch) -> None:
    # ₫375M is $15,000: nothing like the $150 box, so the name match is not trusted.
    result, cur = run_with(monkeypatch, [held("a", "Black Bolt Elite Trainer Box", price=375_000_000)])
    assert result.linked == [] and result.left_for_review == 1
    assert not any("catalog_link_source = 'auto'" in u[0] for u in cur.updates)


def test_dry_run_writes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    result, cur = run_with(monkeypatch, [held("a", "Black Bolt Elite Trainer Box")], dry_run=True)
    assert len(result.linked) == 1
    assert cur.updates == []
    assert result.images_filled == 1  # it would fill this one's image


def test_an_empty_catalogue_does_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    cur = Cur([], [], [])
    monkeypatch.setattr(cl, "connection", lambda: Conn(cur))
    assert cl.link_stock() == cl.LinkResult(0, [], 0, 0)
    assert cur.updates == []


def test_an_item_that_already_has_an_image_is_not_counted_as_filled(monkeypatch: pytest.MonkeyPatch) -> None:
    result, _ = run_with(
        monkeypatch,
        [held("a", "Black Bolt Elite Trainer Box", image="https://ebay/x.jpg")],
        dry_run=True,
    )
    assert len(result.linked) == 1
    assert result.images_filled == 0


def test_a_product_that_merely_starts_with_tag_is_sealed_but_a_tag_slab_is_not():
    from poke_pipeline.catalog_link import is_sealed_candidate

    assert is_sealed_candidate("Tag Team Collection", [])
    assert is_sealed_candidate("Tag Team GX All Stars Box", [])
    assert not is_sealed_candidate("tag 10 oricorio ex 024", [])
    assert not is_sealed_candidate("TAG10 Pikachu", [])
    assert not is_sealed_candidate("slab tag 10 oricorio", [])
