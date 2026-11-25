"""Tests for the price-floor alerts.

The decision rule and message are pure and tested directly. ``run`` is tested
with the database and HTTP client stubbed, to pin down the part that is easy to
get wrong: *when state is written*. An alert must only be recorded as sent after
the webhook accepted it, or a failed POST would swallow it forever.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

from poke_pipeline import floor_alerts as fa
from poke_pipeline.floor_alerts import Candidate, build_message, decide


def cand(
    *,
    id: str = "i1",
    name: str = "Ascended Heroes Elite Trainer Box",
    floor: int = 100,
    price: int = 90,
    currency: str = "VND",
    price_currency: str | None = None,
    held: int = 11,
    alerted: bool = False,
) -> Candidate:
    return Candidate(
        id=id,
        name=name,
        floor_minor=floor,
        currency=currency,
        price_minor=price,
        price_currency=price_currency or currency,
        held=held,
        alerted=alerted,
    )


# ── decide ──────────────────────────────────────────────────────────────


def test_alerts_when_price_is_below_the_floor() -> None:
    d = decide([cand(floor=100, price=90)])
    assert [c.id for c in d.to_alert] == ["i1"]
    assert d.to_rearm == () and d.skipped == ()


def test_alerts_when_price_equals_the_floor() -> None:
    assert len(decide([cand(floor=100, price=100)]).to_alert) == 1


def test_silent_when_price_is_above_the_floor() -> None:
    d = decide([cand(floor=100, price=101)])
    assert d.to_alert == () and d.to_rearm == ()


def test_does_not_repeat_while_still_at_the_floor() -> None:
    d = decide([cand(floor=100, price=60, alerted=True)])
    assert d.to_alert == () and d.to_rearm == ()


def test_rearms_when_price_climbs_back_above_the_floor() -> None:
    d = decide([cand(floor=100, price=120, alerted=True)])
    assert d.to_alert == ()
    assert [c.id for c in d.to_rearm] == ["i1"]


def test_alerts_again_after_a_rearm_cycle() -> None:
    # fall -> alert, recover -> rearm, fall -> alert again.
    assert len(decide([cand(price=60, alerted=False)]).to_alert) == 1
    assert len(decide([cand(price=120, alerted=True)]).to_rearm) == 1
    assert len(decide([cand(price=60, alerted=False)]).to_alert) == 1


def test_currency_mismatch_is_skipped_not_guessed() -> None:
    # 5 USD "is below" 100 VND numerically; comparing would be nonsense.
    d = decide([cand(floor=100, price=5, currency="VND", price_currency="USD")])
    assert d.to_alert == () and d.to_rearm == ()
    assert len(d.skipped) == 1


def test_mismatch_does_not_rearm_an_alerted_item() -> None:
    d = decide([cand(price=500, currency="VND", price_currency="USD", alerted=True)])
    assert d.to_rearm == ()


def test_nothing_held_is_skipped_even_below_the_floor() -> None:
    d = decide([cand(price=10, floor=100, held=0)])
    assert d.to_alert == ()
    assert len(d.skipped) == 1


def test_nothing_held_still_clears_a_stale_flag_once_the_price_is_back_above() -> None:
    d = decide([cand(price=500, floor=100, held=0, alerted=True)])
    assert [c.id for c in d.to_rearm] == ["i1"]


def test_nothing_held_keeps_the_flag_while_the_price_is_still_at_the_floor() -> None:
    d = decide([cand(price=50, floor=100, held=0, alerted=True)])
    assert d.to_rearm == () and d.to_alert == ()


def test_the_floor_is_the_mirror_of_the_sell_target() -> None:
    # The same prices that trigger a sell target (>=) must NOT trigger a floor (<=).
    d = decide([cand(floor=100, price=130)])
    assert d.to_alert == ()


def test_handles_a_mixed_batch() -> None:
    d = decide(
        [
            cand(id="a", price=50),
            cand(id="b", price=130),
            cand(id="c", price=50, alerted=True),
            cand(id="d", price=130, alerted=True),
            cand(id="e", price=1, price_currency="USD"),
            cand(id="f", held=0, price=50),
        ]
    )
    assert [c.id for c in d.to_alert] == ["a"]
    assert [c.id for c in d.to_rearm] == ["d"]
    assert [c.id for c in d.skipped] == ["e", "f"]


# ── message ─────────────────────────────────────────────────────────────


def test_message_names_the_item_the_gap_and_the_stock() -> None:
    msg = build_message((cand(floor=2_000_000, price=1_800_000, held=11),))
    assert "1 item has fallen to your level" in msg
    assert "Ascended Heroes Elite Trainer Box" in msg
    assert "₫1,800,000" in msg and "₫2,000,000" in msg
    assert "10.0% below your floor" in msg
    assert "you hold 11" in msg


def test_message_says_right_at_the_floor_when_equal() -> None:
    assert "right at your floor" in build_message((cand(floor=100, price=100),))


def test_message_pluralises_and_is_not_a_recommendation() -> None:
    msg = build_message((cand(id="a"), cand(id="b", name="Other")))
    assert "2 items have" in msg
    assert "estimates" in msg
    assert "not a recommendation" in msg
    # It must not tell anyone what to do.
    for word in ("sell now", "buy now", "you should"):
        assert word not in msg.lower()


# ── run ─────────────────────────────────────────────────────────────────


def _run(candidates: list[Candidate], **kwargs: Any) -> tuple[fa.Result, MagicMock]:
    conn = MagicMock()

    @contextmanager
    def fake_connection() -> Any:
        yield conn

    set_alerted = MagicMock()
    patches = [
        patch.object(fa, "connection", fake_connection),
        patch.object(fa, "fetch_candidates", return_value=candidates),
        patch.object(fa, "_set_alerted", set_alerted),
    ]
    for p in patches:
        p.start()
    try:
        return fa.run(**kwargs), set_alerted
    finally:
        for p in patches:
            p.stop()


def test_run_posts_then_marks_alerted() -> None:
    with patch.object(fa, "_post", return_value=True) as post:
        result, set_alerted = _run([cand()], webhook_url="http://hook")
    post.assert_called_once()
    assert post.call_args.args[0] == "http://hook"
    assert result.posted and result.alerted == 1
    assert set_alerted.call_args.args[1:] == (["i1"], True)


def test_run_does_not_mark_alerted_when_post_fails() -> None:
    with patch.object(fa, "_post", return_value=False):
        result, set_alerted = _run([cand()], webhook_url="http://hook")
    assert not result.posted and result.alerted == 0
    marked_true = [c for c in set_alerted.call_args_list if c.args[2] is True]
    assert marked_true == []  # the next run retries


def test_run_without_webhook_url_marks_nothing() -> None:
    with (
        patch.object(fa, "_post") as post,
        patch.object(fa, "load_settings", return_value=MagicMock(alert_webhook_url=None)),
    ):
        result, set_alerted = _run([cand()])
    post.assert_not_called()
    assert not result.posted
    assert [c for c in set_alerted.call_args_list if c.args[2] is True] == []


def test_run_rearms_even_without_a_webhook() -> None:
    with patch.object(fa, "_post") as post:
        result, set_alerted = _run([cand(price=150, alerted=True)], webhook_url="http://hook")
    post.assert_not_called()  # nothing new to say
    assert result.rearmed == 1
    assert set_alerted.call_args.args[1:] == (["i1"], False)


def test_dry_run_prints_and_writes_nothing(capsys: Any) -> None:
    with patch.object(fa, "_post") as post:
        result, set_alerted = _run([cand(), cand(id="i2", price=150, alerted=True)], dry_run=True)
    post.assert_not_called()
    set_alerted.assert_not_called()
    assert not result.posted and result.alerted == 1 and result.rearmed == 1
    out = capsys.readouterr().out
    assert "Price floor" in out and "would re-arm 1" in out


# ── big batches ─────────────────────────────────────────────────────────


def _many(n: int) -> list[Candidate]:
    return [cand(id=f"i{k}", name=f"Item number {k} " + "x" * 60) for k in range(n)]


def test_a_big_batch_is_split_into_messages_that_each_fit() -> None:
    groups = fa.split_alerts(tuple(_many(60)))
    assert len(groups) > 1
    assert sum(len(g) for g in groups) == 60
    assert all(len(build_message(g)) <= fa.MAX_MESSAGE_CHARS for g in groups)


def test_a_small_batch_stays_one_message() -> None:
    assert len(fa.split_alerts(tuple(_many(3)))) == 1


def test_a_very_long_name_is_trimmed() -> None:
    msg = build_message((cand(name="N" * 500),))
    assert len(msg) < fa.MAX_MESSAGE_CHARS


def test_run_marks_only_delivered_messages_and_stops_at_the_first_failure() -> None:
    sent = []

    def post(url: str, text: str) -> bool:
        sent.append(text)
        return len(sent) == 1  # first message accepted, second refused

    with patch.object(fa, "_post", side_effect=post):
        result, set_alerted = _run(_many(60), webhook_url="http://hook")
    assert len(sent) == 2  # stopped after the failure
    first_group = fa.split_alerts(tuple(_many(60)))[0]
    marked = [c.args[1] for c in set_alerted.call_args_list if c.args[2] is True]
    assert marked == [[c.id for c in first_group]]
    assert result.alerted == len(first_group)
