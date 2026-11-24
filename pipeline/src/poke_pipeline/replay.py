"""What each sale cost, and what is still held: a port of the app's replay.

This MUST agree with ``replayForAnalytics`` / ``consumeQueue`` in
``src/lib/calc/analytics.ts`` and ``holdings.ts``. Both are tested against the
same file (``tests/fixtures/replay_vectors.json``, written by
``scripts/gen-replay-vectors.ts`` from the app's own code), so a change to one
that is not made in the other fails a test.

The rules, as in the app:

- Buys that have not arrived (``pending``) are not stock yet.
- A sale that names a lot takes units only from that lot; any other sale takes
  the oldest units first (``fifo``), or costs every held unit the pool's
  running average (``average``).
- A sale larger than what is held removes what there is and no more.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class Tx:
    id: str
    type: str
    """'buy' or 'sell'"""
    quantity: int
    value_minor: int
    at: datetime
    lot_id: str | None = None
    status: str = "received"
    exit_reason: str | None = None


@dataclass
class Lot:
    qty: int
    cost: int
    lot_id: str | None = None


@dataclass(frozen=True)
class Sell:
    tx: Tx
    consumed: int
    """Cost of the units that left."""

    @property
    def profit(self) -> int:
        return self.tx.value_minor - self.consumed

    @property
    def is_sale(self) -> bool:
        """A real sale, not a gift, loss or opened pack."""
        return self.tx.exit_reason in (None, "sold")


@dataclass
class Replay:
    sells: list[Sell] = field(default_factory=list)
    remaining: list[Lot] = field(default_factory=list)

    @property
    def held_qty(self) -> int:
        return sum(e.qty for e in self.remaining)

    @property
    def held_cost(self) -> int:
        return sum(e.cost for e in self.remaining)


def _js_round(x: float) -> int:
    """JavaScript's Math.round (halves go up); Python's round() goes to even."""
    return math.floor(x + 0.5)


def _consume(queue: list[Lot], qty: int, lot_id: str | None, method: str) -> int:
    if method == "average":
        pool_qty = sum(e.qty for e in queue)
        pool_cost = sum(e.cost for e in queue)
        take = min(qty, pool_qty)
        if take <= 0:
            return 0
        consumed = pool_cost if take == pool_qty else _js_round(pool_cost * take / pool_qty)
        left = take
        for e in queue:
            if left == 0:
                break
            if e.qty == 0:
                continue
            t = min(left, e.qty)
            e.qty -= t
            left -= t
        rem_qty = pool_qty - take
        rem_cost = pool_cost - consumed
        for e in queue:
            if e.qty == 0:
                e.cost = 0
                continue
            share = rem_cost if e.qty == rem_qty else _js_round(rem_cost * e.qty / rem_qty)
            e.cost = share
            rem_cost -= share
            rem_qty -= e.qty
        return consumed

    to_sell = qty
    consumed = 0
    for e in queue:
        if to_sell == 0:
            break
        if e.qty == 0:
            continue
        if lot_id is not None and e.lot_id != lot_id:
            continue
        take = min(to_sell, e.qty)
        cost = e.cost if take == e.qty else _js_round(e.cost * take / e.qty)
        e.qty -= take
        e.cost -= cost
        consumed += cost
        to_sell -= take
    return consumed


def replay(txs: list[Tx], method: str = "fifo") -> Replay:
    """Replay one item's transactions oldest first."""
    queue: list[Lot] = []
    out = Replay()
    for tx in sorted(txs, key=lambda t: t.at):
        if tx.type == "buy":
            if tx.status == "pending":
                continue
            queue.append(Lot(tx.quantity, tx.value_minor, tx.lot_id))
            continue
        out.sells.append(Sell(tx, _consume(queue, tx.quantity, tx.lot_id, method)))
    out.remaining = [e for e in queue if e.qty > 0]
    return out


def held_on(txs: list[Tx], when: datetime, method: str = "fifo") -> Replay:
    """The replay of everything that happened by ``when``."""
    return replay([t for t in txs if t.at <= when], method)
