"""The shared batching of alert messages, and its use by every alert command."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from poke_pipeline import sell_alerts, watchlist_alerts
from poke_pipeline import webhook_batches as wb


def build(items: tuple[str, ...]) -> str:
    return "\n".join(items)


def test_splits_so_each_message_fits() -> None:
    items = [f"line {i} " + "x" * 90 for i in range(60)]
    groups = wb.split_alerts(items, build, limit=500)
    assert sum(len(g) for g in groups) == 60
    assert all(len(build(g)) <= 500 for g in groups)
    assert [x for g in groups for x in g] == items  # order kept


def test_nothing_to_send_makes_no_groups() -> None:
    assert wb.split_alerts([], build) == []


def test_one_oversized_alert_still_goes_out_alone() -> None:
    groups = wb.split_alerts(["x" * 900, "y"], build, limit=100)
    assert groups == [("x" * 900,), ("y",)]


def test_deliver_stops_at_first_refusal_and_counts_only_delivered() -> None:
    marked: list[tuple[str, ...]] = []
    posted: list[str] = []

    def post(text: str) -> bool:
        posted.append(text)
        return len(posted) < 2

    n = wb.deliver([("a",), ("b", "c"), ("d",)], build, post, marked.append)
    assert n == 1 and marked == [("a",)] and len(posted) == 2


def test_names_are_trimmed() -> None:
    assert wb.trim_name("short") == "short"
    assert len(wb.trim_name("N" * 500)) == wb.MAX_NAME_CHARS


# ── the other alert commands use it ─────────────────────────────────────


def _run(module: Any, candidates: list[Any], post: Any) -> tuple[Any, MagicMock]:
    conn = MagicMock()

    @contextmanager
    def fake_connection() -> Any:
        yield conn

    marked = MagicMock()
    with (
        patch.object(module, "connection", fake_connection),
        patch.object(module, "fetch_candidates", return_value=candidates),
        patch.object(module, "_set_alerted", marked),
        patch.object(module, "_post", side_effect=post),
    ):
        return module.run(webhook_url="http://hook"), marked


@pytest.mark.parametrize("module", [sell_alerts, watchlist_alerts])
def test_sell_and_watchlist_alerts_send_big_batches_in_pieces(module: Any) -> None:
    if module is sell_alerts:
        cands = [
            sell_alerts.Candidate(f"i{k}", f"Item {k} " + "x" * 80, 100, "VND", 200, "VND", 3, False)
            for k in range(60)
        ]
    else:
        cands = [
            watchlist_alerts.Candidate(f"i{k}", f"Item {k} " + "x" * 80, 200, "VND", 100, "VND", False)
            for k in range(60)
        ]
    sent: list[str] = []

    def post(url: str, text: str) -> bool:
        sent.append(text)
        return True

    result, marked = _run(module, cands, post)
    assert len(sent) > 1
    assert all(len(t) <= wb.MAX_MESSAGE_CHARS for t in sent)
    assert result.alerted == 60
    marked_ids = [i for c in marked.call_args_list if c.args[2] is True for i in c.args[1]]
    assert sorted(marked_ids) == sorted(c.id for c in cands)
