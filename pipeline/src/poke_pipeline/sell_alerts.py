"""Daily sell-target alerts.

An item can carry a *sell target* ("tell me when this reaches ₫3M"), set on
the item's page in the web app. This module compares it with the newest
market price on a schedule and posts one webhook message listing everything
that has reached its target. It is the mirror of ``watchlist_alerts`` (buy
targets), with the same rules, chosen to be quiet rather than chatty:

- **Alert once per crossing.** ``sell_target_alerted_at`` records that an
  alert went out. While the price stays at or above target, later runs say
  nothing. When it falls back below target the flag is cleared ("re-armed"),
  so the next climb alerts again. Changing the target in the app clears it
  too.
- **A webhook failure loses nothing.** Items are marked alerted only after
  the POST succeeds, so a failed run is retried by the next one.
- **Only comparable prices.** The market price must be in the same currency
  as the target; anything else is skipped and counted, never converted (the
  pipeline has no FX rates, and a stale rate could fire a false alert).
- **Only what you hold.** An item with nothing in stock is skipped: there is
  nothing to sell, so there is nothing to tell you about. "Held" is received
  buys minus sells, the same as the app.

Market prices are estimates, so the message is a prompt to look, not a promise
that a buyer will pay that.

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

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Candidate:
    """One item with a sell target and a current market price."""

    id: str
    name: str
    target_minor: int
    currency: str
    price_minor: int
    price_currency: str
    held: int
    alerted: bool
    """True when ``sell_target_alerted_at`` is already set."""


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
        if c.price_currency != c.currency or c.held <= 0:
            skipped.append(c)
            continue
        at_target = c.price_minor >= c.target_minor
        if at_target and not c.alerted:
            to_alert.append(c)
        elif not at_target and c.alerted:
            to_rearm.append(c)
    return Decision(tuple(to_alert), tuple(to_rearm), tuple(skipped))


def _line(c: Candidate) -> str:
    now = format_money(c.price_minor, c.currency)
    target = format_money(c.target_minor, c.currency)
    if c.price_minor == c.target_minor:
        gap = "right at your target"
    else:
        above = (c.price_minor - c.target_minor) / c.target_minor * 100
        gap = f"{above:.1f}% above your target"
    return f"• *{wb.trim_name(c.name)}* — now {now} ({gap} of {target}) · you hold {c.held}"


def build_message(alerts: tuple[Candidate, ...]) -> str:
    n = len(alerts)
    noun = "item has" if n == 1 else "items have"
    lines = [f"💰 *Sell target: {n} {noun} reached your price*", ""]
    lines.extend(_line(c) for c in alerts)
    lines += ["", "_Market prices are estimates; check a real offer before counting on it._"]
    return "\n".join(lines)


def fetch_candidates(conn: Connection[Any]) -> list[Candidate]:
    """Items with a target, joined to their newest market price and stock."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              i.id::text AS id,
              i.name,
              i.sell_target_cents AS target,
              i.sell_target_currency AS currency,
              p.price_cents AS price,
              p.currency AS price_currency,
              COALESCE(h.held, 0) AS held,
              (i.sell_target_alerted_at IS NOT NULL) AS alerted
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
            WHERE i.sell_target_cents IS NOT NULL
              AND i.sell_target_currency IS NOT NULL
            ORDER BY i.name
            """
        )
        rows = cur.fetchall()
    return [
        Candidate(
            id=r["id"],
            name=r["name"],
            target_minor=int(r["target"]),
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
            SET sell_target_alerted_at = CASE WHEN %s THEN now() ELSE NULL END
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
        log.warning("sell-alerts: webhook POST failed: %s", e)
        return False


def run(*, dry_run: bool = False, webhook_url: str | None = None) -> Result:
    """Check every item with a sell target and alert on new crossings.

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
                "sell-alerts: skipping %r — %s",
                c.name,
                "nothing held" if c.held <= 0 else f"target in {c.currency} but price in {c.price_currency}",
            )

        groups = wb.split_alerts(decision.to_alert, build_message)

        if dry_run:
            log.info("sell-alerts: dry run — nothing sent or written")
            print("\n\n".join(build_message(g) for g in groups) if groups else "(no new sell alerts)")
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
                "sell-alerts: %d item(s) reached target but ALERT_WEBHOOK_URL "
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
                log.info("sell-alerts: alerted on %d item(s)", delivered)
        posted = delivered > 0

        return Result(
            checked=checked,
            alerted=delivered,
            rearmed=len(decision.to_rearm),
            skipped=len(decision.skipped),
            posted=posted,
        )
