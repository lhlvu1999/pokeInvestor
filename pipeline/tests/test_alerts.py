"""Unit tests for the alert webhook path.

The DB and HTTP interactions are mocked; we only exercise the *filtering*
and *formatting* logic so we don't need a real Postgres or webhook target.

Query order the module makes (only if the earlier steps produced any
matches to look up):
  1. `_held_item_ids` — held row per linked item id
  2. `_watchlist_matches` — one row per matching watchlist entry
  3. `_item_names` — id → name (only when there are held matches)
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from poke_pipeline.alerts import send_mention_alerts


def _fake_conn(fetch_responses: list[list[dict[str, Any]]]) -> Any:
    """Build a connection stand-in that returns the enqueued list of
    fetchall responses in order. Extra fetchall calls return an empty
    list (defensive)."""
    conn = MagicMock()
    cur = MagicMock()
    cur.__enter__.return_value = cur

    queue = list(fetch_responses)

    def fetchall() -> list[dict[str, Any]]:
        return queue.pop(0) if queue else []

    cur.fetchall.side_effect = fetchall
    conn.cursor.return_value = cur
    return conn


def test_no_webhook_url_is_noop() -> None:
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        send_mention_alerts(
            _fake_conn([]),
            webhook_url=None,
            video_id="vid",
            video_title="t",
            channel_title=None,
            mentions=[{"item_id": "x", "raw_name": "y", "sentiment": "bullish"}],
        )
        client.assert_not_called()


def test_no_matched_items_is_noop() -> None:
    # Nothing matches held (empty response), nothing matches watchlist (empty).
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        send_mention_alerts(
            _fake_conn([[], []]),
            webhook_url="https://example.com/hook",
            video_id="vid",
            video_title="t",
            channel_title=None,
            mentions=[
                {"item_id": None, "raw_name": "unmatched", "sentiment": "bullish"}
            ],
        )
        client.assert_not_called()


def test_no_held_and_no_watchlist_is_noop() -> None:
    # Mention has an item_id but user doesn't hold it AND it's not watchlisted.
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        send_mention_alerts(
            _fake_conn([[], []]),
            webhook_url="https://example.com/hook",
            video_id="vid",
            video_title="t",
            channel_title="Creator",
            mentions=[
                {
                    "item_id": "abc",
                    "raw_name": "Ascended Heroes ETB",
                    "sentiment": "bullish",
                }
            ],
        )
        client.assert_not_called()


def test_posts_when_held_item_matched() -> None:
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        posted = client.return_value.__enter__.return_value
        send_mention_alerts(
            _fake_conn(
                [
                    # 1. held-item lookup: 'abc' is held
                    [{"item_id": "abc"}],
                    # 2. watchlist lookup: no matches
                    [],
                    # 3. item-names lookup
                    [{"id": "abc", "name": "Ascended Heroes ETB"}],
                ]
            ),
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
                {
                    "item_id": None,
                    "raw_name": "unmatched",
                    "sentiment": "neutral",
                },
            ],
        )
        posted.post.assert_called_once()
        _, kwargs = posted.post.call_args
        payload = kwargs["json"]
        assert "text" in payload and "content" in payload
        assert "In your portfolio" in payload["text"]
        assert "Ascended Heroes ETB" in payload["text"]
        assert "vid123" in payload["text"]
        assert "PokéBeard" in payload["text"]
        assert "explode" in payload["text"]


def test_posts_when_watchlist_matched_by_item_id() -> None:
    """User has 'xyz' on their watchlist (linked to item_id) but doesn't
    hold it. The alert should still fire, under the *Watchlist* section."""
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        posted = client.return_value.__enter__.return_value
        send_mention_alerts(
            _fake_conn(
                [
                    # 1. held-item lookup: not held
                    [],
                    # 2. watchlist lookup: matches by item_id
                    [
                        {
                            "item_id": "xyz",
                            "wl_name": "Journey Together ETB",
                            "wl_name_lower": "journey together etb",
                        }
                    ],
                ]
            ),
            webhook_url="https://example.com/hook",
            video_id="vid456",
            video_title="Upcoming set predictions",
            channel_title="PokéCoach",
            mentions=[
                {
                    "item_id": "xyz",
                    "raw_name": "JT ETB",
                    "sentiment": "bullish",
                    "quote": "pre-order now",
                }
            ],
        )
        posted.post.assert_called_once()
        _, kwargs = posted.post.call_args
        text = kwargs["json"]["text"]
        assert "On your watchlist" in text
        assert "Journey Together ETB" in text
        assert "pre-order now" in text


def test_posts_when_watchlist_matched_by_name() -> None:
    """Floating watchlist entry (no item_id) matches on lower(raw_name).
    The mention has no item_id either, so `_held_item_ids` never queries
    the DB — the first fetchall call is straight to _watchlist_matches."""
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        posted = client.return_value.__enter__.return_value
        send_mention_alerts(
            _fake_conn(
                [
                    # Only the watchlist query hits the DB.
                    [
                        {
                            "item_id": None,
                            "wl_name": "Journey Together Booster Bundle",
                            "wl_name_lower": "journey together booster bundle",
                        }
                    ],
                ]
            ),
            webhook_url="https://example.com/hook",
            video_id="vidfloat",
            video_title="Set reveal",
            channel_title=None,
            mentions=[
                {
                    "item_id": None,
                    "raw_name": "Journey Together Booster Bundle",
                    "sentiment": "bullish",
                }
            ],
        )
        posted.post.assert_called_once()
        text = posted.post.call_args.kwargs["json"]["text"]
        assert "On your watchlist" in text
        assert "Journey Together Booster Bundle" in text


def test_does_not_double_report_held_and_watchlisted() -> None:
    """If an item is BOTH held and on the watchlist, only the held
    section should mention it — no duplicate line."""
    with patch("poke_pipeline.alerts.httpx.Client") as client:
        posted = client.return_value.__enter__.return_value
        send_mention_alerts(
            _fake_conn(
                [
                    [{"item_id": "abc"}],  # held
                    [
                        {
                            "item_id": "abc",
                            "wl_name": "Ascended Heroes ETB",
                            "wl_name_lower": "ascended heroes etb",
                        }
                    ],  # also on watchlist
                    [{"id": "abc", "name": "Ascended Heroes ETB"}],
                ]
            ),
            webhook_url="https://example.com/hook",
            video_id="vid_dup",
            video_title="Meta review",
            channel_title="Someone",
            mentions=[
                {
                    "item_id": "abc",
                    "raw_name": "Ascended Heroes ETB",
                    "sentiment": "bullish",
                }
            ],
        )
        text = posted.post.call_args.kwargs["json"]["text"]
        # "In your portfolio" appears once; "On your watchlist" doesn't
        # appear at all (no *additional* watchlist-only mentions).
        assert text.count("Ascended Heroes ETB") == 1
        assert "In your portfolio" in text
        assert "On your watchlist" not in text
