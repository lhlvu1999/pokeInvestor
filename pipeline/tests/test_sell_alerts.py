"""Tests for the sell-target alerts.

The decision rule and message are pure and tested directly. ``run`` is tested
with the database and HTTP client stubbed, to pin down the part that is easy to
get wrong: *when state is written*. An alert must only be recorded as sent
after the webhook accepted it, or a failed POST would swallow it forever.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

from poke_pipeline import sell_alerts as sa
from poke_pipeline.sell_alerts import Candidate, build_message, decide


def cand(
    *,
    id: str = "i1",
    name: str = "Ascended Heroes Elite Trainer Box",
    target: int = 100,
    price: int = 110,
    currency: str = "VND",
    price_currency: str | None = None,
    held: int = 11,
    alerted: bool = False,
) -> Candidate:
    return Candidate(
        id=id,
        name=name,
        target_minor=target,
        currency=currency,
        price_minor=price,
        price_currency=price_currency or currency,
        held=held,
        alerted=alerted,
    )


# ── decide ──────────────────────────────────────────────────────────────


def test_alerts_when_price_is_above_target() -> None:
    d = decide([cand(target=100, price=110)])
    assert [c.id for c in d.to_alert] == ["i1"]
    assert d.to_rearm == () and d.skipped == ()


def test_alerts_when_price_equals_target() -> None:
    assert len(decide([cand(target=100, price=100)]).to_alert) == 1


def test_silent_when_price_is_below_target() -> None:
    d = decide([cand(target=100, price=99)])
    assert d.to_alert == () and d.to_rearm == ()


def test_does_not_repeat_while_still_at_target() -> None:
    d = decide([cand(target=100, price=130, alerted=True)])
    assert d.to_alert == () and d.to_rearm == ()


def test_rearms_when_price_falls_back_below_target() -> None:
    d = decide([cand(target=100, price=80, alerted=True)])
    assert d.to_alert == ()
    assert [c.id for c in d.to_rearm] == ["i1"]


def test_alerts_again_after_a_rearm_cycle() -> None:
    # climb -> alert, fall -> rearm, climb -> alert again.
    assert len(decide([cand(price=130, alerted=False)]).to_alert) == 1
    assert len(decide([cand(price=80, alerted=True)]).to_rearm) == 1
    assert len(decide([cand(price=130, alerted=False)]).to_alert) == 1


def test_currency_mismatch_is_skipped_not_guessed() -> None:
    # 5000 USD "is above" 100 VND numerically; comparing would be nonsense.
    d = decide([cand(target=100, price=5000, currency="VND", price_currency="USD")])
    assert d.to_alert == () and d.to_rearm == ()
    assert len(d.skipped) == 1


def test_mismatch_does_not_rearm_an_alerted_item() -> None:
    d = decide([cand(price=1, currency="VND", price_currency="USD", alerted=True)])
    assert d.to_rearm == ()


def test_nothing_held_is_skipped_even_at_target() -> None:
    d = decide([cand(price=500, target=100, held=0)])
    assert d.to_alert == ()
    assert len(d.skipped) == 1


def test_nothing_held_leaves_an_alerted_flag_alone() -> None:
    # Sold out and the price dipped: not our business to re-arm an item you
    # no longer hold (re-stocking later should start from what you set).
    d = decide([cand(price=50, target=100, held=0, alerted=True)])
    assert d.to_rearm == ()


def test_handles_a_mixed_batch() -> None:
    d = decide(
        [
            cand(id="a", price=130),
            cand(id="b", price=50),
            cand(id="c", price=130, alerted=True),
            cand(id="d", price=50, alerted=True),
            cand(id="e", price=1, price_currency="USD"),
            cand(id="f", held=0, price=130),
        ]
    )
    assert [c.id for c in d.to_alert] == ["a"]
    assert [c.id for c in d.to_rearm] == ["d"]
    assert [c.id for c in d.skipped] == ["e", "f"]


# ── message ─────────────────────────────────────────────────────────────


def test_message_names_the_item_the_gap_and_the_stock() -> None:
    msg = build_message((cand(target=3_000_000, price=3_300_000, held=11),))
    assert "1 item has reached your price" in msg
    assert "Ascended Heroes Elite Trainer Box" in msg
    assert "₫3,300,000" in msg and "₫3,000,000" in msg
    assert "10.0% above your target" in msg
    assert "you hold 11" in msg


def test_message_says_right_at_target_when_equal() -> None:
    assert "right at your target" in build_message((cand(target=100, price=100),))


def test_message_pluralises_and_warns_prices_are_estimates() -> None:
    msg = build_message((cand(id="a"), cand(id="b", name="Other")))
    assert "2 items have" in msg
    assert "estimates" in msg


# ── run ─────────────────────────────────────────────────────────────────


def _run(candidates: list[Candidate], **kwargs: Any) -> tuple[sa.Result, MagicMock]:
    conn = MagicMock()

    @contextmanager
    def fake_connection() -> Any:
        yield conn

    set_alerted = MagicMock()
    patches = [
        patch.object(sa, "connection", fake_connection),
        patch.object(sa, "fetch_candidates", return_value=candidates),
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
    assert set_alerted.call_args.args[1:] == (["i1"], True)


def test_run_does_not_mark_alerted_when_post_fails() -> None:
    with patch.object(sa, "_post", return_value=False):
        result, set_alerted = _run([cand()], webhook_url="http://hook")
    assert not result.posted and result.alerted == 0
    marked_true = [c for c in set_alerted.call_args_list if c.args[2] is True]
    assert marked_true == []  # the next run retries


def test_run_without_webhook_url_marks_nothing() -> None:
    with (
        patch.object(sa, "_post") as post,
        patch.object(sa, "load_settings", return_value=MagicMock(alert_webhook_url=None)),
    ):
        result, set_alerted = _run([cand()])
    post.assert_not_called()
    assert not result.posted
    assert [c for c in set_alerted.call_args_list if c.args[2] is True] == []


def test_run_rearms_even_without_a_webhook() -> None:
    with patch.object(sa, "_post") as post:
        result, set_alerted = _run([cand(price=50, alerted=True)], webhook_url="http://hook")
    post.assert_not_called()  # nothing new to say
    assert result.rearmed == 1
    assert set_alerted.call_args.args[1:] == (["i1"], False)


def test_run_posts_nothing_when_nothing_is_new() -> None:
    with patch.object(sa, "_post") as post:
        result, _ = _run([cand(price=50)], webhook_url="http://hook")
    post.assert_not_called()
    assert result.alerted == 0 and result.checked == 1


def test_dry_run_neither_posts_nor_writes(capsys: Any) -> None:
    with patch.object(sa, "_post") as post:
        result, set_alerted = _run(
            [cand(), cand(id="i2", price=50, alerted=True)],
            dry_run=True,
            webhook_url="http://hook",
        )
    post.assert_not_called()
    set_alerted.assert_not_called()
    assert not result.posted and result.alerted == 1 and result.rearmed == 1
    out = capsys.readouterr().out
    assert "Ascended Heroes Elite Trainer Box" in out and "re-arm" in out


def test_post_returns_false_on_http_error() -> None:
    client = MagicMock()
    client.__enter__.return_value = client
    client.post.return_value.raise_for_status.side_effect = RuntimeError("boom")
    with patch.object(sa.httpx, "Client", return_value=client):
        assert sa._post("http://hook", "hi") is False


def test_post_sends_slack_and_discord_keys() -> None:
    client = MagicMock()
    client.__enter__.return_value = client
    with patch.object(sa.httpx, "Client", return_value=client):
        assert sa._post("http://hook", "hello") is True
    assert client.post.call_args.kwargs["json"] == {"text": "hello", "content": "hello"}
