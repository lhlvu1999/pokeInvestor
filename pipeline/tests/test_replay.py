import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from poke_pipeline.replay import Tx, held_on, replay

VECTORS = json.loads(
    (Path(__file__).parent / "fixtures" / "replay_vectors.json").read_text()
)["cases"]


def _tx(d: dict) -> Tx:
    return Tx(
        id=d["id"],
        type=d["type"],
        quantity=d["quantity"],
        value_minor=d["finalValueCents"],
        at=datetime.fromisoformat(d["occurredAt"].replace("Z", "+00:00")),
        lot_id=d["lotId"],
        status=d["status"],
        exit_reason=d["exitReason"],
    )


def test_vectors_are_substantial():
    # Guard against the fixture quietly shrinking to nothing.
    assert len(VECTORS) >= 100
    assert any(c["method"] == "average" for c in VECTORS)
    assert any(any(s["exitReason"] for s in c["sells"]) for c in VECTORS)


@pytest.mark.parametrize("i", range(len(VECTORS)))
def test_matches_the_app(i):
    case = VECTORS[i]
    r = replay([_tx(t) for t in case["txs"]], case["method"])
    assert [(s.tx.id, s.consumed, s.tx.quantity) for s in r.sells] == [
        (s["id"], s["consumed"], s["quantity"]) for s in case["sells"]
    ]
    assert [(e.qty, e.cost) for e in r.remaining] == [
        (e["qty"], e["cost"]) for e in case["remaining"]
    ]


def _t(type_, day, qty, value, **kw):
    return Tx(
        id=f"{type_}{day}",
        type=type_,
        quantity=qty,
        value_minor=value,
        at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=day),
        **kw,
    )


def test_fifo_takes_the_oldest_units_first():
    r = replay([_t("buy", 1, 1, 100), _t("buy", 2, 1, 300), _t("sell", 3, 1, 500)])
    assert r.sells[0].consumed == 100
    assert r.sells[0].profit == 400
    assert (r.held_qty, r.held_cost) == (1, 300)


def test_average_costs_every_unit_the_same():
    r = replay([_t("buy", 1, 1, 100), _t("buy", 2, 1, 300), _t("sell", 3, 1, 500)], "average")
    assert r.sells[0].consumed == 200
    assert r.held_cost == 200


def test_pending_buys_are_not_stock():
    r = replay([_t("buy", 1, 5, 500, status="pending")])
    assert r.held_qty == 0


def test_a_sale_larger_than_stock_removes_only_what_exists():
    r = replay([_t("buy", 1, 1, 100), _t("sell", 2, 3, 900)])
    assert r.sells[0].consumed == 100
    assert r.held_qty == 0


def test_write_offs_are_not_sales():
    r = replay([_t("buy", 1, 2, 200), _t("sell", 2, 1, 0, exit_reason="gifted"), _t("sell", 3, 1, 300)])
    assert [s.is_sale for s in r.sells] == [False, True]


def test_held_on_ignores_the_future():
    txs = [_t("buy", 1, 2, 200), _t("sell", 5, 1, 300)]
    assert held_on(txs, datetime(2026, 1, 3, tzinfo=UTC)).held_qty == 2
    assert held_on(txs, datetime(2026, 1, 9, tzinfo=UTC)).held_qty == 1
