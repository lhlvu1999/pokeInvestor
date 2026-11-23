"""Tests for the watchlist price-target alerts.

The decision rule and message are pure and tested directly. `run` is tested
with the database and HTTP client stubbed, to pin down the part that is easy
to get wrong: *when state is written*. An alert must only be recorded as
sent after the webhook accepted it, or a failed POST would silently swallow
the alert forever.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

from poke_pipeline import watchlist_alerts as wa
from poke_pipeline.watchlist_alerts import Candidate, build_message, decide, format_money


def cand(
    *,
    id: str = "w1",
    name: str = "Prismatic Evolutions ETB",
    target: int = 100,
    price: int = 90,
    currency: str = "VND",
    price_currency: str | None = None,
    alerted: bool = False,
) -> Candidate:
    return Candidate(
        id=id,
        name=name,
        target_minor=target,
        currency=currency,
        price_minor=price,
        price_currency=price_currency or currency,
        alerted=alerted,
    )


# ── decide ──────────────────────────────────────────────────────────────


def test_alerts_when_price_is_below_target() -> None:
    d = decide([cand(target=100, price=90)])
    assert [c.id for c in d.to_alert] == ["w1"]
    assert d.to_rearm == () and d.skipped == ()


def test_alerts_when_price_equals_target() -> None:
    assert len(decide([cand(target=100, price=100)]).to_alert) == 1


def test_silent_when_price_is_above_target() -> None:
    d = decide([cand(target=100, price=101)])
    assert d.to_alert == () and d.to_rearm == ()


def test_does_not_repeat_while_still_at_target() -> None:
    d = decide([cand(target=100, price=90, alerted=True)])
    assert d.to_alert == () and d.to_rearm == ()


def test_rearms_when_price_climbs_back_above_target() -> None:
    d = decide([cand(target=100, price=130, alerted=True)])
    assert d.to_alert == ()
    assert [c.id for c in d.to_rearm] == ["w1"]


def test_alerts_again_after_a_rearm_cycle() -> None:
    # dip -> alert, rise -> rearm, dip -> alert again.
    assert len(decide([cand(price=90, alerted=False)]).to_alert) == 1
    assert len(decide([cand(price=130, alerted=True)]).to_rearm) == 1
    assert len(decide([cand(price=90, alerted=False)]).to_alert) == 1


def test_currency_mismatch_is_skipped_not_guessed() -> None:
    # 5 USD "is below" 100 VND numerically; comparing would be nonsense.
    d = decide([cand(target=100, price=5, currency="VND", price_currency="USD")])
    assert d.to_alert == () and d.to_rearm == ()
    assert len(d.skipped) == 1


def test_mismatch_does_not_rearm_an_alerted_entry() -> None:
    d = decide([cand(price=999, currency="VND", price_currency="USD", alerted=True)])
    assert d.to_rearm == ()


def test_handles_a_mixed_batch() -> None:
    d = decide(
        [
            cand(id="a", price=90),
            cand(id="b", price=200),
            cand(id="c", price=90, alerted=True),
            cand(id="d", price=200, alerted=True),
            cand(id="e", price=1, price_currency="USD"),
        ]
    )
    assert [c.id for c in d.to_alert] == ["a"]
    assert [c.id for c in d.to_rearm] == ["d"]
    assert [c.id for c in d.skipped] == ["e"]


# ── formatting ──────────────────────────────────────────────────────────


def test_format_money_zero_decimal_currency() -> None:
    assert format_money(2964609, "VND") == "₫2,964,609"
    assert format_money(1500, "JPY") == "¥1,500"


def test_format_money_two_decimal_currency() -> None:
    assert format_money(11293, "USD") == "$112.93"
    assert format_money(100, "EUR") == "€1.00"


def test_format_money_unknown_symbol_falls_back_to_code() -> None:
    assert format_money(12345, "CAD") == "CAD 123.45"


def test_message_names_the_product_and_the_gap() -> None:
    msg = build_message((cand(target=2_500_000, price=2_250_000),))
    assert "1 product has" in msg
    assert "Prismatic Evolutions ETB" in msg
    assert "₫2,250,000" in msg and "₫2,500,000" in msg
    assert "10.0% below" in msg


def test_message_says_right_at_target_when_equal() -> None:
    assert "right at your target" in build_message((cand(target=100, price=100),))


def test_message_pluralises() -> None:
    msg = build_message((cand(id="a"), cand(id="b", name="Other")))
    assert "2 products have" in msg


# ── run ─────────────────────────────────────────────────────────────────


def _patched(candidates: list[Candidate]) -> Any:
    """Patch the DB layer; return the mock that records state writes."""
    conn = MagicMock()

    @contextmanager
    def fake_connection() -> Any:
        yield conn

    set_alerted = MagicMock()
    stack = [
        patch.object(wa, "connection", fake_connection),
        patch.object(wa, "fetch_candidates", return_value=candidates),
        patch.object(wa, "_set_alerted", set_alerted),
    ]
    return stack, set_alerted


def _run(candidates: list[Candidate], **kwargs: Any) -> tuple[wa.Result, MagicMock]:
    stack, set_alerted = _patched(candidates)
    for p in stack:
        p.start()
    try:
        return wa.run(**kwargs), set_alerted
    finally:
        for p in stack:
            p.stop()


def test_run_posts_then_marks_alerted() -> None:
    with patch.object(wa, "_post", return_value=True) as post:
        result, set_alerted = _run([cand()], webhook_url="http://hook")
    post.assert_called_once()
    assert post.call_args.args[0] == "http://hook"
    assert result.posted and result.alerted == 1
    # The last write marks the alerted entry (an earlier no-op re-arm call
    # with an empty list may precede it).
    assert set_alerted.call_args.args[1:] == (["w1"], True)


def test_run_does_not_mark_alerted_when_post_fails() -> None:
    with patch.object(wa, "_post", return_value=False):
        result, set_alerted = _run([cand()], webhook_url="http://hook")
    assert not result.posted and result.alerted == 0
    # Nothing was recorded as alerted, so the next run retries.
    marked_true = [c for c in set_alerted.call_args_list if c.args[2] is True]
    assert marked_true == []


def test_run_without_webhook_url_marks_nothing() -> None:
    with (
        patch.object(wa, "_post") as post,
        patch.object(wa, "load_settings", return_value=MagicMock(alert_webhook_url=None)),
    ):
        result, set_alerted = _run([cand()])
    post.assert_not_called()
    assert not result.posted
    assert [c for c in set_alerted.call_args_list if c.args[2] is True] == []


def test_run_rearms_even_without_a_webhook() -> None:
    with patch.object(wa, "_post") as post:
        result, set_alerted = _run([cand(price=500, alerted=True)], webhook_url="http://hook")
    post.assert_not_called()  # nothing new to say
    assert result.rearmed == 1
    set_alerted.assert_called_once()
    assert set_alerted.call_args.args[1:] == (["w1"], False)


def test_run_posts_nothing_when_nothing_is_new() -> None:
    with patch.object(wa, "_post") as post:
        result, _ = _run([cand(price=500)], webhook_url="http://hook")
    post.assert_not_called()
    assert result.alerted == 0 and result.checked == 1


def test_dry_run_neither_posts_nor_writes(capsys: Any) -> None:
    with patch.object(wa, "_post") as post:
        result, set_alerted = _run(
            [cand(), cand(id="w2", price=500, alerted=True)],
            dry_run=True,
            webhook_url="http://hook",
        )
    post.assert_not_called()
    set_alerted.assert_not_called()
    assert not result.posted and result.alerted == 1 and result.rearmed == 1
    out = capsys.readouterr().out
    assert "Prismatic Evolutions ETB" in out and "re-arm" in out


def test_post_returns_false_on_http_error() -> None:
    client = MagicMock()
    client.__enter__.return_value = client
    client.post.return_value.raise_for_status.side_effect = RuntimeError("boom")
    with patch.object(wa.httpx, "Client", return_value=client):
        assert wa._post("http://hook", "hi") is False


def test_post_sends_slack_and_discord_keys() -> None:
    client = MagicMock()
    client.__enter__.return_value = client
    with patch.object(wa.httpx, "Client", return_value=client):
        assert wa._post("http://hook", "hello") is True
    assert client.post.call_args.kwargs["json"] == {"text": "hello", "content": "hello"}
