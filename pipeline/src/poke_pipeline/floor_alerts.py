"""Daily price-floor alerts.

An item can carry a *price floor* ("tell me if this falls to ₫2M"), set on the
item's page in the web app. This module compares it with the newest market price
on a schedule and posts one webhook message listing everything that has fallen
to its floor. It is the mirror of ``sell_alerts`` (which watches for a price
rising to a target), with the same rules, chosen to be quiet rather than chatty:

- **Alert once per crossing.** ``floor_alerted_at`` records that an alert went
  out. While the price stays at or below the floor, later runs say nothing. When
  it climbs back above the floor the flag is cleared ("re-armed"), so the next
  fall alerts again. Changing the floor in the app clears it too.
- **A webhook failure loses nothing.** Items are marked alerted only after the
  POST succeeds, so a failed run is retried by the next one.
- **Only comparable prices.** The market price must be in the same currency as
  the floor; anything else is skipped and counted, never converted.
- **Only what you hold.** An item with nothing in stock is skipped. "Held" is
  received buys minus sells, the same as the app.

It is a heads-up about a price you chose to watch, not a recommendation to do
anything, and market prices are estimates; the message says both.

Same webhook as the other alerts (``ALERT_WEBHOOK_URL``): the body carries both
``text`` and ``content``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx
from psycopg import Connection

from poke_pipeline import webhook_batches as wb
from poke_pipeline.config import load_settings
from poke_pipeline.db import connection
from poke_pipeline.watchlist_alerts import format_money

MAX_MESSAGE_CHARS = wb.MAX_MESSAGE_CHARS

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Candidate:
    """One item with a price floor and a current market price."""

    id: str
    name: str
    floor_minor: int
    currency: str
    price_minor: int
    price_currency: str
    held: int
    alerted: bool
    """True when ``floor_alerted_at`` is already set."""


@dataclass(frozen=True)
class Decision:
    to_alert: tuple[Candidate, ...]
    to_rearm: tuple[Candidate, ...]
    skipped: tuple[Candidate, ...]
    """Different currencies, or nothing held: not comparable / not relevant."""


@dataclass(frozen=True)
class Result:
    checked: int
    alerted: int
    rearmed: int
    skipped: int
    posted: bool
    """True only if a message was actually delivered."""


def decide(candidates: list[Candidate]) -> Decision:
    """Pure rule: which items to alert on, re-arm, or skip."""
    to_alert: list[Candidate] = []
    to_rearm: list[Candidate] = []
    skipped: list[Candidate] = []
    for c in candidates:
        if c.price_currency != c.currency:
            skipped.append(c)
            continue
        at_floor = c.price_minor <= c.floor_minor
        if c.held <= 0:
            # Nothing to alert about, but a stale "alerted" mark still clears once the
            # price is back above the floor, so a later rebuy starts fresh.
            if c.alerted and not at_floor:
                to_rearm.append(c)
            else:
                skipped.append(c)
            continue
        if at_floor and not c.alerted:
            to_alert.append(c)
        elif not at_floor and c.alerted:
            to_rearm.append(c)
    return Decision(tuple(to_alert), tuple(to_rearm), tuple(skipped))


def _line(c: Candidate) -> str:
    now = format_money(c.price_minor, c.currency)
    floor = format_money(c.floor_minor, c.currency)
    if c.price_minor == c.floor_minor:
        gap = "right at your floor"
    else:
        below = (c.floor_minor - c.price_minor) / c.floor_minor * 100
        gap = f"{below:.1f}% below your floor"
    return f"• *{wb.trim_name(c.name)}* — now {now} ({gap} of {floor}) · you hold {c.held}"


def split_alerts(alerts: tuple[Candidate, ...]) -> list[tuple[Candidate, ...]]:
    """Group alerts so each group's message fits in one webhook message."""
    return wb.split_alerts(alerts, build_message, MAX_MESSAGE_CHARS)


def build_message(alerts: tuple[Candidate, ...]) -> str:
    n = len(alerts)
    noun = "item has" if n == 1 else "items have"
    lines = [f"🔻 *Price floor: {n} {noun} fallen to your level*", ""]
    lines.extend(_line(c) for c in alerts)
    lines += [
        "",
        "_A heads-up about a price you chose to watch, not a recommendation. "
        "Market prices are estimates; check the real market._",
    ]
    return "\n".join(lines)


def fetch_candidates(conn: Connection[Any]) -> list[Candidate]:
    """Items with a floor, joined to their newest market price and stock."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              i.id::text AS id,
              i.name,
              i.floor_cents AS floor,
              i.floor_currency AS currency,
              p.price_cents AS price,
              p.currency AS price_currency,
              COALESCE(h.held, 0) AS held,
              (i.floor_alerted_at IS NOT NULL) AS alerted
            FROM items i
            JOIN LATERAL (
              SELECT price_cents, currency
              FROM market_prices m
              WHERE m.item_id = i.id
              ORDER BY m.fetched_at DESC
              LIMIT 1
            ) p ON true
            LEFT JOIN LATERAL (
              SELECT SUM(CASE
                           WHEN t.type = 'buy' AND t.status = 'received' THEN t.quantity
                           WHEN t.type = 'sell' THEN -t.quantity
                           ELSE 0
                         END)::int AS held
              FROM transactions t
              WHERE t.item_id = i.id
            ) h ON true
            WHERE i.floor_cents IS NOT NULL
              AND i.floor_currency IS NOT NULL
            ORDER BY i.name
            """
        )
        rows = cur.fetchall()
    return [
        Candidate(
            id=r["id"],
            name=r["name"],
            floor_minor=int(r["floor"]),
            currency=r["currency"],
            price_minor=int(r["price"]),
            price_currency=r["price_currency"],
            held=int(r["held"]),
            alerted=bool(r["alerted"]),
        )
        for r in rows
    ]


def _set_alerted(conn: Connection[Any], ids: list[str], alerted: bool) -> None:
    if not ids:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE items
            SET floor_alerted_at = CASE WHEN %s THEN now() ELSE NULL END
            WHERE id = ANY(%s::uuid[])
            """,
            (alerted, ids),
        )


def _post(webhook_url: str, text: str) -> bool:
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(webhook_url, json={"text": text, "content": text})
            r.raise_for_status()
        return True
    except Exception as e:
        log.warning("floor-alerts: webhook POST failed: %s", e)
        return False


def run(*, dry_run: bool = False, webhook_url: str | None = None) -> Result:
    """Check every item with a price floor and alert on new crossings.

    ``dry_run`` prints what would be sent and changes nothing: no POST, no
    database writes.
    """
    url = webhook_url if webhook_url is not None else load_settings().alert_webhook_url

    with connection() as conn:
        candidates = fetch_candidates(conn)
        decision = decide(candidates)
        checked = len(candidates)

        for c in decision.skipped:
            log.info(
                "floor-alerts: skipping %r — %s",
                c.name,
                "nothing held" if c.held <= 0 else f"floor in {c.currency} but price in {c.price_currency}",
            )

        groups = split_alerts(decision.to_alert)

        if dry_run:
            log.info("floor-alerts: dry run — nothing sent or written")
            print("\n\n".join(build_message(g) for g in groups) if groups else "(no new floor alerts)")
            if decision.to_rearm:
                print(f"(would re-arm {len(decision.to_rearm)} item(s))")
            return Result(
                checked=checked,
                alerted=len(decision.to_alert),
                rearmed=len(decision.to_rearm),
                skipped=len(decision.skipped),
                posted=False,
            )

        # Re-arming is plain bookkeeping and needs no webhook.
        _set_alerted(conn, [c.id for c in decision.to_rearm], False)

        delivered = 0
        if groups and not url:
            log.warning(
                "floor-alerts: %d item(s) at their floor but ALERT_WEBHOOK_URL "
                "is not set — will retry next run",
                len(decision.to_alert),
            )
        elif groups:
            # One message per group; only delivered groups are marked, and the first
            # failure stops the run so the rest are retried next time.
            delivered = wb.deliver(
                groups,
                build_message,
                lambda text: _post(url, text),
                lambda g: _set_alerted(conn, [c.id for c in g], True),
            )
            if delivered:
                log.info("floor-alerts: alerted on %d item(s)", delivered)
        posted = delivered > 0

        return Result(
            checked=checked,
            alerted=delivered,
            rearmed=len(decision.to_rearm),
            skipped=len(decision.skipped),
            posted=posted,
        )
