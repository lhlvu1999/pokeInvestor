"""Tests for the opt-in "usual low point" watchlist alerts.

The usual-low rule, the decision and the message are pure and tested directly;
the rule is also checked against the TypeScript implementation on a shared
random cohort. ``run`` is tested with the database and HTTP client stubbed, to
pin down the part that is easy to get wrong: *when state is written*. An alert
must only be recorded as sent after the webhook accepted it.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from poke_pipeline import stage_alerts as sa
from poke_pipeline.stage_alerts import (
    Candidate,
    Low,
    ProductAges,
    at_low,
    build_message,
    bulk_dates,
    decide,
    pct,
    quantile,
    usual_lows,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "usual_low_vectors.json").read_text(encoding="utf-8")
)


# ── usual lows ──────────────────────────────────────────────────────────


def cohort(kind: str, language: str, shape: dict[int, float], n: int = 10) -> list[ProductAges]:
    """n sets, each with one product at 100 on day 7 and 100*shape[age] later."""
    return [
        ProductAges(
            group_id=i,
            kind=kind,  # type: ignore[arg-type]
            language=language,
            prices={7: 100, **{a: round(100 * f) for a, f in shape.items()}},
        )
        for i in range(n)
    ]


def test_finds_the_age_with_the_lowest_typical_price() -> None:
    lows = usual_lows(cohort("etb", "en", {30: 0.92, 60: 0.85, 90: 0.9, 180: 1.02}))
    low = lows[("etb", "en")]
    assert low.age == 60
    assert low.median == pytest.approx(-0.15)
    assert low.sets == 10


def test_no_usual_low_without_a_real_dip() -> None:
    assert usual_lows(cohort("box", "en", {30: 0.97, 60: 1.1})) == {}
    # Exactly 5% below counts.
    assert ("box", "en") in usual_lows(cohort("box", "en", {30: 0.95}))


def test_needs_eight_sets() -> None:
    shape = {60: 0.8}
    assert usual_lows(cohort("etb", "en", shape, n=7)) == {}
    assert ("etb", "en") in usual_lows(cohort("etb", "en", shape, n=8))


def test_ignores_ages_beyond_a_year_and_the_base_age() -> None:
    assert usual_lows(cohort("etb", "en", {450: 0.1, 30: 0.99})) == {}


def test_a_tie_keeps_the_earlier_age() -> None:
    assert usual_lows(cohort("etb", "en", {30: 0.9, 60: 0.9}))[("etb", "en")].age == 30


def test_a_set_counts_once_however_many_products_it_has() -> None:
    # Set 0 has three products; its value is their median, not three votes.
    products = cohort("etb", "en", {60: 0.9}, n=8)
    products += [
        ProductAges(0, "etb", "en", {7: 100, 60: 10}),
        ProductAges(0, "etb", "en", {7: 100, 60: 10}),
    ]
    low = usual_lows(products)[("etb", "en")]
    assert low.sets == 8


def test_missing_and_zero_prices_are_skipped() -> None:
    products = cohort("etb", "en", {60: 0.8}, n=8)
    products.append(ProductAges(99, "etb", "en", {7: None, 60: 5}))
    products.append(ProductAges(98, "etb", "en", {7: 100, 60: 0}))
    assert usual_lows(products)[("etb", "en")].sets == 8


def test_kinds_and_languages_are_separate() -> None:
    products = cohort("etb", "en", {60: 0.8}) + cohort("pack", "ja", {45: 0.7})
    lows = usual_lows(products)
    assert set(lows) == {("etb", "en"), ("pack", "ja")}


def test_quantile_matches_the_apps_interpolation() -> None:
    assert quantile([1, 2, 3, 4], 0.5) == 2.5
    assert quantile([10, 20], 0.25) == 12.5
    assert quantile([5], 0.9) == 5


def test_agrees_with_typescript_on_the_shared_cohort() -> None:
    products = [
        ProductAges(
            group_id=p["group_id"],
            kind=p["kind"],
            language=p["language"],
            prices={int(a): v for a, v in p["prices"].items()},
        )
        for p in FIXTURE["products"]
    ]
    lows = usual_lows(products)
    expected = {k: v for k, v in FIXTURE["expected"].items() if v is not None}
    assert {f"{k}:{lang}" for k, lang in lows} == set(expected)
    assert len(expected) >= 3, "the fixture should exercise several kinds"
    for (kind, lang), low in lows.items():
        want = expected[f"{kind}:{lang}"]
        assert low.age == want["age"]
        assert low.sets == want["sets"]
        for field in ("median", "p25", "p75"):
            assert getattr(low, field) == pytest.approx(want[field], rel=1e-12, abs=1e-12)


def test_bulk_dates_are_dates_many_sets_share() -> None:
    dates = ["2026-11-22"] * 10 + ["2026-05-22"] * 2 + [None, "2026-01-01"]
    assert bulk_dates(dates) == {"2026-11-22"}


# ── decisions ───────────────────────────────────────────────────────────

LOWS = {("etb", "en"): Low(age=60, median=-0.112, p25=-0.15, p75=-0.01, sets=17)}


def cand(
    *,
    id: str = "w1",
    name: str = "Ascended Heroes ETB",
    product: str = "Ascended Heroes Elite Trainer Box",
    language: str = "en",
    age: int | None = 58,
    own: float | None = -0.04,
) -> Candidate:
    return Candidate(
        id=id,
        name=name,
        product_name=product,
        language=language,
        age_days=age,
        own_change=own,
    )


def test_alerts_inside_the_window() -> None:
    d = decide([cand(age=58)], LOWS)
    assert [c.id for c, _, _ in d.to_alert] == ["w1"]
    assert d.skipped == ()


def test_window_is_fourteen_days_either_side() -> None:
    low = LOWS[("etb", "en")]
    assert at_low(46, low) and at_low(74, low)
    assert not at_low(45, low) and not at_low(75, low)
    assert decide([cand(age=45)], LOWS).to_alert == ()
    assert decide([cand(age=75)], LOWS).to_alert == ()


def test_silent_before_the_window() -> None:
    d = decide([cand(age=20)], LOWS)
    assert d.to_alert == () and d.skipped == ()


def test_skips_what_cannot_be_compared() -> None:
    d = decide(
        [
            cand(id="a", age=None),  # no age
            cand(id="b", product="Charizard ex Special Collection"),  # not a tracked kind
            cand(id="c", language="ja"),  # no usual low for Japanese ETBs
            cand(id="d", product="Black Bolt Booster Box"),  # a kind with no usual low
        ],
        LOWS,
    )
    assert d.to_alert == ()
    assert [c.id for c in d.skipped] == ["a", "b", "c", "d"]


def test_handles_a_mixed_batch() -> None:
    d = decide([cand(id="a", age=60), cand(id="b", age=10), cand(id="c", age=None)], LOWS)
    assert [c.id for c, _, _ in d.to_alert] == ["a"]
    assert [c.id for c in d.skipped] == ["c"]


# ── message ─────────────────────────────────────────────────────────────


def test_pct_uses_a_real_minus_sign() -> None:
    assert pct(0.123) == "+12.3%"
    assert pct(-0.04) == "\N{MINUS SIGN}4.0%"
    assert pct(0) == "0.0%"


def test_message_describes_the_past_and_is_not_advice() -> None:
    c = cand()
    msg = build_message([(c, "etb", LOWS[("etb", "en")])])
    assert "1 product has reached the usual low point" in msg
    assert "Ascended Heroes ETB" in msg
    assert "Elite Trainer Boxes have usually been lowest around day 60" in msg
    assert "17 sets" in msg
    assert "\N{MINUS SIGN}4.0% since day 7" in msg
    assert "not a recommendation" in msg


def test_message_pluralises_and_omits_unknown_change() -> None:
    low = LOWS[("etb", "en")]
    msg = build_message([(cand(id="a"), "etb", low), (cand(id="b", own=None), "etb", low)])
    assert "2 products have" in msg
    assert msg.count("since day 7.") == 1  # only the one with a known change


# ── run ─────────────────────────────────────────────────────────────────


def _run(
    candidates: list[Candidate], lows: dict[Any, Low] | None = None, **kwargs: Any
) -> tuple[sa.Result, MagicMock]:
    conn = MagicMock()

    @contextmanager
    def fake_connection() -> Any:
        yield conn

    set_alerted = MagicMock()
    patches = [
        patch.object(sa, "connection", fake_connection),
        patch.object(sa, "fetch_candidates", return_value=candidates),
        patch.object(sa, "fetch_lows", return_value=LOWS if lows is None else lows),
        patch.object(sa, "_set_alerted", set_alerted),
    ]
    for p in patches:
        p.start()
    try:
        return sa.run(**kwargs), set_alerted
    finally:
        for p in patches:
            p.stop()


def test_run_posts_then_marks_alerted() -> None:
    with patch.object(sa, "_post", return_value=True) as post:
        result, set_alerted = _run([cand()], webhook_url="http://hook")
    post.assert_called_once()
    assert post.call_args.args[0] == "http://hook"
    assert result.posted and result.alerted == 1
    assert set_alerted.call_args.args[1] == ["w1"]


def test_run_does_not_mark_alerted_when_post_fails() -> None:
    with patch.object(sa, "_post", return_value=False):
        result, set_alerted = _run([cand()], webhook_url="http://hook")
    assert not result.posted and result.alerted == 0
    set_alerted.assert_not_called()  # the next run retries


def test_run_without_webhook_url_marks_nothing() -> None:
    with (
        patch.object(sa, "_post") as post,
        patch.object(sa, "load_settings", return_value=MagicMock(alert_webhook_url=None)),
    ):
        result, set_alerted = _run([cand()])
    post.assert_not_called()
    assert not result.posted
    set_alerted.assert_not_called()


def test_run_does_nothing_when_no_entry_opted_in() -> None:
    with patch.object(sa, "_post") as post:
        result, _ = _run([], webhook_url="http://hook")
    post.assert_not_called()
    assert result.checked == 0 and result.alerted == 0


def test_run_posts_nothing_when_nothing_is_at_its_low() -> None:
    with patch.object(sa, "_post") as post:
        result, set_alerted = _run([cand(age=5)], webhook_url="http://hook")
    post.assert_not_called()
    set_alerted.assert_not_called()
    assert result.alerted == 0 and result.checked == 1


def test_dry_run_neither_posts_nor_writes(capsys: Any) -> None:
    with patch.object(sa, "_post") as post:
        result, set_alerted = _run([cand()], dry_run=True, webhook_url="http://hook")
    post.assert_not_called()
    set_alerted.assert_not_called()
    assert not result.posted and result.alerted == 1
    assert "Ascended Heroes ETB" in capsys.readouterr().out


def test_post_returns_false_on_http_error() -> None:
    client = MagicMock()
    client.__enter__.return_value = client
    client.post.return_value.raise_for_status.side_effect = RuntimeError("boom")
    with patch.object(sa.httpx, "Client", return_value=client):
        assert sa._post("http://hook", "hi") is False
