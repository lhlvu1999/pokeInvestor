"""A weekly summary posted to the alert webhook.

One message a week, so you see how the week went without opening the app:

- **Stock**: what it is worth at market, what it was worth a week ago, and
  what *prices* did to the stock you kept. The headline value rises when you
  buy and falls when you sell, so it says nothing about prices on its own; the
  "kept stock" line values the units you held both times at both prices, which
  is the part that is the market's doing.
- **The week**: sales (money in, cost, profit), what you spent, and the year's
  profit so far.
- **Worth a look**: sell targets and price floors reached, orders that are
  overdue, entries that look like slips, and no recent backup.

Rules, chosen to be quiet and honest:

- **Read-only.** Nothing is written to the database; it is safe to run any time.
  ``--dry-run`` prints the message instead of posting it.
- **Same numbers as the app.** Costs come from ``replay.py``, a tested port of
  the app's replay, with the cost method you chose in Settings.
- **Money in your display currency**, converted with the stored exchange rates.
  An item whose currency has no rate is left out and counted, never guessed.
- **Market prices are estimates**, so the message says so. Past moves are
  history, not a forecast.
- **Fits a chat message**: Discord rejects bodies over 2000 characters, so the
  message is trimmed (movers first) to stay under that.

Same webhook as the other alerts (``ALERT_WEBHOOK_URL``): the body carries both
``text`` and ``content``.
"""

from __future__ import annotations

import bisect
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from psycopg import Connection

from poke_pipeline.config import load_settings
from poke_pipeline.db import connection
from poke_pipeline.replay import Replay, Tx, held_on, replay
from poke_pipeline.watchlist_alerts import _SYMBOLS, _ZERO_DECIMAL

log = logging.getLogger(__name__)

WINDOW_DAYS = 7
OVERDUE_DELIVERY_DAYS = 14
BACKUP_STALE_DAYS = 30
MAX_MESSAGE_CHARS = 1900
"""Under Discord's 2000-character limit, with room for the header."""
TOP_MOVERS = 3
MAX_NAMES = 3
DEFAULT_CURRENCY = "VND"


# ── Money ──────────────────────────────────────────────────────────────────


def _exponent(currency: str) -> int:
    return 0 if currency in _ZERO_DECIMAL else 2


def convert(minor: int, src: str, dst: str, usd_to: dict[str, float]) -> int | None:
    """``minor`` units of ``src`` in ``dst``, or None when a rate is missing.

    Rates are 'units of that currency per 1 USD', as stored by the app.
    """
    if src == dst:
        return minor
    major = minor / 10 ** _exponent(src)
    if src != "USD":
        rate = usd_to.get(src)
        if not rate or rate <= 0:
            return None
        major /= rate
    if dst != "USD":
        rate = usd_to.get(dst)
        if not rate or rate <= 0:
            return None
        major *= rate
    return round(major * 10 ** _exponent(dst))


def compact_money(minor: int, currency: str, *, signed: bool = False) -> str:
    """Short amount for a chat line: ₫1.74B, ₫12.4M, ₫5,000, -$12.30."""
    symbol = _SYMBOLS.get(currency) or f"{currency} "
    major = abs(minor) / 10 ** _exponent(currency)
    if major >= 1e9:
        body = f"{major / 1e9:.2f}B"
    elif major >= 1e6:
        body = f"{major / 1e6:.1f}M"
    elif _exponent(currency) == 0:
        body = f"{major:,.0f}"
    else:
        body = f"{major:,.2f}"
    sign = "−" if minor < 0 else ("+" if signed and minor > 0 else "")  # noqa: RUF001 (typographic minus/dash, as in the app)
    return f"{sign}{symbol}{body}"


def _pct(x: float) -> str:
    return f"{'+' if x > 0 else '−' if x < 0 else ''}{abs(x) * 100:.1f}%"  # noqa: RUF001 (typographic minus/dash, as in the app)


# ── Inputs ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Price:
    at: datetime
    cents: int
    currency: str


@dataclass
class ItemData:
    id: str
    name: str
    currency: str
    """The currency of the item's transactions."""
    txs: list[Tx]
    prices: list[Price] = field(default_factory=list)
    """Oldest first."""
    sell_target: tuple[int, str] | None = None
    floor: tuple[int, str] | None = None


@dataclass(frozen=True)
class Inputs:
    items: list[ItemData]
    now: datetime
    display: str
    usd_to: dict[str, float]
    method: str = "fifo"
    last_backup_at: datetime | None = None
    pending_buys: list[tuple[str, int, datetime]] = field(default_factory=list)
    """(item name, units, ordered at) for buys paid for but not received."""


def price_at(prices: list[Price], when: datetime) -> Price | None:
    """Latest price on or before ``when``."""
    i = bisect.bisect_right([p.at for p in prices], when)
    return prices[i - 1] if i else None


# ── The numbers ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Move:
    name: str
    effect: int
    pct: float | None


@dataclass
class Digest:
    display: str
    start: datetime
    end: datetime
    value_now: int = 0
    value_then: int = 0
    priced_now: int = 0
    held_now: int = 0
    kept_items: int = 0
    kept_effect: int = 0
    kept_base: int = 0
    gainers: list[Move] = field(default_factory=list)
    losers: list[Move] = field(default_factory=list)
    sales: int = 0
    units_sold: int = 0
    proceeds: int = 0
    cost_of_sales: int = 0
    write_offs: int = 0
    spent: int = 0
    buys: int = 0
    ytd_net: int = 0
    sell_targets: list[str] = field(default_factory=list)
    floors: list[str] = field(default_factory=list)
    overdue_units: int = 0
    overdue_orders: int = 0
    overdue_oldest_days: int = 0
    free_sales: int = 0
    future_dated: int = 0
    backup_days: int | None = None
    unconverted: int = 0
    """Items left out of money figures because no exchange rate was found."""

    @property
    def kept_pct(self) -> float | None:
        return self.kept_effect / self.kept_base if self.kept_base > 0 else None


def compute(inp: Inputs) -> Digest:
    now = inp.now
    start = now - timedelta(days=WINDOW_DAYS)
    d = Digest(display=inp.display, start=start, end=now)
    movers: list[Move] = []
    skipped: set[str] = set()

    def conv(item: ItemData, minor: int, currency: str | None = None) -> int | None:
        v = convert(minor, currency or item.currency, inp.display, inp.usd_to)
        if v is None:
            skipped.add(item.id)
        return v

    for it in inp.items:
        if not it.txs:
            continue
        r_now: Replay = held_on(it.txs, now, inp.method)
        r_then: Replay = held_on(it.txs, start, inp.method)
        p_now = price_at(it.prices, now)
        p_then = price_at(it.prices, start)

        # Stock value, now and a week ago.
        if r_now.held_qty > 0:
            d.held_now += 1
            if p_now:
                v = conv(it, r_now.held_qty * p_now.cents, p_now.currency)
                if v is not None:
                    d.value_now += v
                    d.priced_now += 1
        if r_then.held_qty > 0 and p_then:
            v = conv(it, r_then.held_qty * p_then.cents, p_then.currency)
            if v is not None:
                d.value_then += v

        # What prices did to the units held both times.
        kept = min(r_now.held_qty, r_then.held_qty)
        if kept > 0 and p_now and p_then:
            a = conv(it, kept * p_now.cents, p_now.currency)
            b = conv(it, kept * p_then.cents, p_then.currency)
            if a is not None and b is not None:
                d.kept_items += 1
                d.kept_effect += a - b
                d.kept_base += b
                movers.append(Move(it.name, a - b, (a - b) / b if b > 0 else None))

        # Sales and write-offs, from the full replay.
        full = replay(it.txs, inp.method)
        for s in full.sells:
            at = s.tx.at
            if at.astimezone(UTC).year == now.astimezone(UTC).year and at <= now:
                v = conv(it, s.profit)
                if v is not None:
                    d.ytd_net += v
            if start < at <= now:
                if s.is_sale:
                    proceeds = conv(it, s.tx.value_minor)
                    cost = conv(it, s.consumed)
                    if proceeds is not None and cost is not None:
                        d.sales += 1
                        d.units_sold += s.tx.quantity
                        d.proceeds += proceeds
                        d.cost_of_sales += cost
                else:
                    d.write_offs += 1
            if s.tx.value_minor == 0 and s.tx.exit_reason is None:
                d.free_sales += 1

        for t in it.txs:
            if t.type == "buy" and start < t.at <= now:
                v = conv(it, t.value_minor)
                if v is not None:
                    d.spent += v
                    d.buys += 1
            if t.at > now + timedelta(days=1):
                d.future_dated += 1

        if (
            it.sell_target
            and r_now.held_qty > 0
            and p_now
            and p_now.currency == it.sell_target[1]
            and p_now.cents >= it.sell_target[0]
        ):
            d.sell_targets.append(it.name)
        if (
            it.floor
            and r_now.held_qty > 0
            and p_now
            and p_now.currency == it.floor[1]
            and p_now.cents <= it.floor[0]
        ):
            d.floors.append(it.name)

    d.gainers = sorted((m for m in movers if m.effect > 0), key=lambda m: -m.effect)[:TOP_MOVERS]
    d.losers = sorted((m for m in movers if m.effect < 0), key=lambda m: m.effect)[:TOP_MOVERS]

    overdue_cut = now - timedelta(days=OVERDUE_DELIVERY_DAYS)
    late = [(n, u, at) for n, u, at in inp.pending_buys if at <= overdue_cut]
    d.overdue_units = sum(u for _, u, _ in late)
    d.overdue_orders = len(late)
    d.overdue_oldest_days = max(((now - at).days for _, _, at in late), default=0)

    if inp.last_backup_at is not None:
        d.backup_days = max(0, (now - inp.last_backup_at).days)
    d.unconverted = len(skipped)
    return d


# ── The message ────────────────────────────────────────────────────────────


def _names(names: list[str]) -> str:
    shown = ", ".join(names[:MAX_NAMES])
    extra = len(names) - MAX_NAMES
    return f"{shown} +{extra} more" if extra > 0 else shown


def _move_line(label: str, moves: list[Move], cur: str) -> str:
    parts = []
    for m in moves:
        pct = f" ({_pct(m.pct)})" if m.pct is not None else ""
        parts.append(f"{m.name} {compact_money(m.effect, cur, signed=True)}{pct}")
    return f"{label} " + " · ".join(parts)


def _attention(d: Digest) -> list[str]:
    lines: list[str] = []
    n = len(d.sell_targets)
    if n:
        noun = "item has" if n == 1 else "items have"
        lines.append(f"• {n} {noun} reached your sell target: {_names(d.sell_targets)}")
    n = len(d.floors)
    if n:
        noun = "item has" if n == 1 else "items have"
        lines.append(f"• {n} {noun} fallen to your price floor: {_names(d.floors)}")
    if d.overdue_units:
        lines.append(
            f"• {d.overdue_units} unit{'s' if d.overdue_units != 1 else ''} on the way for "
            f"{OVERDUE_DELIVERY_DAYS}+ days (oldest {d.overdue_oldest_days}d)"
        )
    if d.free_sales:
        lines.append(
            f"• {d.free_sales} sale{'s' if d.free_sales != 1 else ''} for nothing not marked "
            "gifted or lost (skews win rate)"
        )
    if d.future_dated:
        lines.append(f"• {d.future_dated} entr{'ies' if d.future_dated != 1 else 'y'} dated in the future")
    if d.backup_days is None:
        lines.append("• No backup of your data yet")
    elif d.backup_days >= BACKUP_STALE_DAYS:
        lines.append(f"• Last backup was {d.backup_days} days ago")
    if d.unconverted:
        lines.append(
            f"• {d.unconverted} item{'s' if d.unconverted != 1 else ''} left out: no exchange rate"
        )
    return lines


def _dates(d: Digest) -> str:
    def f(x: datetime) -> str:
        return f"{x:%b} {x.day}"

    return f"{f(d.start)} – {f(d.end)}"  # noqa: RUF001 (typographic minus/dash, as in the app)


def build_message(d: Digest) -> str:
    cur = d.display

    def build(*, movers: bool) -> str:
        lines = [f"📅 *Weekly summary* · {_dates(d)}", ""]

        if d.held_now == 0:
            lines.append("📦 *Stock* — nothing held right now")
        else:
            now = compact_money(d.value_now, cur) if d.priced_now else "no priced items"
            head = f"📦 *Stock* — {now} at market"
            if d.priced_now:
                head += f" ({d.priced_now} of {d.held_now} items priced)"
            if d.value_then > 0:
                head += f", was {compact_money(d.value_then, cur)} a week ago"
            lines.append(head)
            if d.kept_items:
                pct = d.kept_pct
                lines.append(
                    f"Prices moved the stock you kept by *{compact_money(d.kept_effect, cur, signed=True)}"
                    + (f" ({_pct(pct)})" if pct is not None else "")
                    + f"* across {d.kept_items} item{'s' if d.kept_items != 1 else ''}."
                )
            if movers and d.gainers:
                lines.append(_move_line("▲", d.gainers, cur))
            if movers and d.losers:
                lines.append(_move_line("▼", d.losers, cur))

        lines.append("")
        if d.sales:
            profit = d.proceeds - d.cost_of_sales
            week = (
                f"{d.sales} sale{'s' if d.sales != 1 else ''} brought in "
                f"{compact_money(d.proceeds, cur)}, profit {compact_money(profit, cur, signed=True)}"
            )
        else:
            week = "no sales"
        if d.write_offs:
            week += f" (+{d.write_offs} gifted/lost)"
        spent = (
            f"spent {compact_money(d.spent, cur)} on {d.buys} buy{'s' if d.buys != 1 else ''}"
            if d.buys
            else "nothing bought"
        )
        lines.append(f"💵 *This week* — {week} · {spent}")
        lines.append(f"This year so far: {compact_money(d.ytd_net, cur, signed=True)} realized profit")

        att = _attention(d)
        if att:
            lines += ["", "👀 *Worth a look*", *att]
        lines += ["", "_Market prices are estimates and past moves aren't a forecast._"]
        return "\n".join(lines)

    msg = build(movers=True)
    if len(msg) > MAX_MESSAGE_CHARS:
        msg = build(movers=False)
    if len(msg) > MAX_MESSAGE_CHARS:
        msg = msg[: MAX_MESSAGE_CHARS - 1].rstrip() + "…"
    return msg


# ── The database and the webhook ───────────────────────────────────────────


def _setting(conn: Connection[Any], key: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = %s", (key,))
        row = cur.fetchone()
    return None if row is None else str(row["value"])


def fetch_inputs(conn: Connection[Any], now: datetime) -> Inputs:
    display = (_setting(conn, "display_currency") or DEFAULT_CURRENCY).upper()
    method = _setting(conn, "cost_method")
    method = method if method in ("fifo", "average") else "fifo"
    backup_raw = _setting(conn, "last_backup_at")
    backup = None
    if backup_raw:
        try:
            backup = datetime.fromisoformat(backup_raw.replace("Z", "+00:00"))
        except ValueError:
            backup = None

    with conn.cursor() as cur:
        cur.execute("SELECT quote, rate FROM fx_rates WHERE base = 'USD'")
        usd_to = {r["quote"]: float(r["rate"]) for r in cur.fetchall()}
        cur.execute(
            "SELECT id::text AS id, name, sell_target_cents, sell_target_currency, "
            "floor_cents, floor_currency FROM items ORDER BY name"
        )
        item_rows = cur.fetchall()
        cur.execute(
            """
            SELECT id::text AS id, item_id::text AS item_id, type::text AS type, quantity,
                   final_value_cents, occurred_at, lot_id::text AS lot_id,
                   status::text AS status, exit_reason, currency
              FROM transactions ORDER BY occurred_at, created_at, id
            """
        )
        tx_rows = cur.fetchall()
        cur.execute(
            "SELECT item_id::text AS item_id, price_cents, currency, fetched_at "
            "FROM market_prices ORDER BY fetched_at"
        )
        price_rows = cur.fetchall()

    txs: dict[str, list[Tx]] = {}
    currency: dict[str, str] = {}
    pending: list[tuple[str, int, datetime]] = []
    names = {r["id"]: r["name"] for r in item_rows}
    for r in tx_rows:
        currency.setdefault(r["item_id"], r["currency"])
        t = Tx(
            id=r["id"],
            type=r["type"],
            quantity=int(r["quantity"]),
            value_minor=int(r["final_value_cents"]),
            at=r["occurred_at"],
            lot_id=r["lot_id"],
            status=r["status"],
            exit_reason=r["exit_reason"],
        )
        txs.setdefault(r["item_id"], []).append(t)
        if t.type == "buy" and t.status == "pending":
            pending.append((names.get(r["item_id"], "?"), t.quantity, t.at))
    prices: dict[str, list[Price]] = {}
    for r in price_rows:
        prices.setdefault(r["item_id"], []).append(
            Price(r["fetched_at"], int(r["price_cents"]), r["currency"])
        )

    items = [
        ItemData(
            id=r["id"],
            name=r["name"],
            currency=currency[r["id"]],
            txs=txs[r["id"]],
            prices=prices.get(r["id"], []),
            sell_target=(
                (int(r["sell_target_cents"]), r["sell_target_currency"])
                if r["sell_target_cents"] is not None and r["sell_target_currency"]
                else None
            ),
            floor=(
                (int(r["floor_cents"]), r["floor_currency"])
                if r["floor_cents"] is not None and r["floor_currency"]
                else None
            ),
        )
        for r in item_rows
        if r["id"] in txs
    ]
    return Inputs(
        items=items,
        now=now,
        display=display,
        usd_to=usd_to,
        method=method,
        last_backup_at=backup,
        pending_buys=pending,
    )


def _post(webhook_url: str, text: str) -> bool:
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(webhook_url, json={"text": text, "content": text})
            r.raise_for_status()
        return True
    except Exception as e:
        log.warning("weekly-digest: webhook POST failed: %s", e)
        return False


@dataclass(frozen=True)
class Result:
    message: str
    posted: bool
    """True only if the message was actually delivered."""


def run(
    *,
    dry_run: bool = False,
    webhook_url: str | None = None,
    now: datetime | None = None,
) -> Result:
    """Build this week's summary and post it. Writes nothing to the database."""
    url = webhook_url if webhook_url is not None else load_settings().alert_webhook_url
    when = now or datetime.now(UTC)
    with connection() as conn:
        message = build_message(compute(fetch_inputs(conn, when)))
    if dry_run:
        log.info("weekly-digest: dry run — nothing sent")
        print(message)
        return Result(message, False)
    if not url:
        log.warning("weekly-digest: ALERT_WEBHOOK_URL is not set — nothing sent")
        return Result(message, False)
    posted = _post(url, message)
    if posted:
        log.info("weekly-digest: posted")
    return Result(message, posted)
