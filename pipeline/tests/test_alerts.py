"""Unit tests for the alert webhook path.

The DB and HTTP interactions are mocked; we only exercise the *filtering*
and *formatting* logic so we don't need a real Postgres or webhook target.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from poke_pipeline.alerts import send_mention_alerts


def _fake_conn(held_ids: list[str], names: dict[str, str]) -> Any:
    """Build a connection stand-in whose cursor.execute + fetchall return
    what the alerts module expects (held-item ids, then names)."""
    conn = MagicMock()
    cur = MagicMock()
    cur.__enter__.return_value = cur

    call_count = {"n": 0}

    def fetchall() -> list[dict[str, str]]:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return [{"item_id": i} for i in held_ids]
        return [{"id": i, "name": n} for i, n in names.items()]

    cur.fetchall.side_effect = fetchall
    conn.cursor.return_value = cur
    return conn


def test_no_webhook_url_is_noop() -> None:
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        send_mention_alerts(
            _fake_conn([], {}),
            webhook_url=None,
            video_id="vid",
            video_title="t",
            channel_title=None,
            mentions=[{"item_id": "x", "raw_name": "y", "sentiment": "bullish"}],
        )
        client.assert_not_called()


def test_no_matched_items_is_noop() -> None:
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        send_mention_alerts(
            _fake_conn([], {}),
            webhook_url="https://example.com/hook",
            video_id="vid",
            video_title="t",
            channel_title=None,
            mentions=[{"item_id": None, "raw_name": "unmatched", "sentiment": "bullish"}],
        )
        client.assert_not_called()


def test_no_held_items_is_noop() -> None:
    # Matcher linked to an item, but the user doesn't hold it — no alert.
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        send_mention_alerts(
            _fake_conn([], {}),
            webhook_url="https://example.com/hook",
            video_id="vid",
            video_title="t",
            channel_title="Creator",
            mentions=[
                {"item_id": "abc", "raw_name": "Ascended Heroes ETB", "sentiment": "bullish"}
            ],
        )
        client.assert_not_called()


def test_posts_when_held_item_matched() -> None:
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        posted = client.return_value.__enter__.return_value
        send_mention_alerts(
            _fake_conn(["abc"], {"abc": "Ascended Heroes ETB"}),
            webhook_url="https://example.com/hook",
            video_id="vid123",
            video_title="Top 10 sealed picks",
            channel_title="PokéBeard",
            mentions=[
                {
                    "item_id": "abc",
                    "raw_name": "AH ETB",
                    "sentiment": "bullish",
                    "quote": "this one's going to explode",
                },
                {"item_id": None, "raw_name": "unmatched", "sentiment": "neutral"},
            ],
        )
        posted.post.assert_called_once()
        _, kwargs = posted.post.call_args
        payload = kwargs["json"]
        assert "text" in payload and "content" in payload
        assert "Ascended Heroes ETB" in payload["text"]
        assert "vid123" in payload["text"]
        assert "PokéBeard" in payload["text"]
        assert "explode" in payload["text"]
