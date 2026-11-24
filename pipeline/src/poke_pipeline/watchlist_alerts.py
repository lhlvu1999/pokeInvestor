"""Daily watchlist price-target alerts.

A watchlist entry can carry a *buy target* ("tell me when this drops to
₫2.5M"). The web app stores the target; nothing in it ever compared the
target to the market price. This module does, on a schedule, and posts one
webhook message listing everything that has reached its target.

Rules, chosen to be quiet rather than chatty:

- **Alert once per crossing.** `target_alerted_at` records that an alert
  went out. While the price stays at or below target, later runs say
  nothing. When it climbs back above target the flag is cleared
  ("re-armed"), so the next dip alerts again.
- **A webhook failure loses nothing.** Entries are marked alerted only
  after the POST succeeds, so a failed run is retried by the next one.
- **Only comparable prices.** The entry must be linked to an item (that is
  where the market price lives) and the price must be in the same currency
  as the target. Anything else is skipped and counted, never guessed at —
  the pipeline has no FX rates, and converting with a stale rate could
  fire a false alert.

`hit_at` is deliberately untouched: it retires an entry from the active
watchlist, which is the user's call (they bought it), not ours.

Same webhook as the mention alerts (`ALERT_WEBHOOK_URL`): the body carries
both `text` and `content`, so it works with Slack, Discord and generic
JSON endpoints.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx
from psycopg import Connection

from poke_pipeline.config import load_settings
from poke_pipeline.db import connection

log = logging.getLogger(__name__)

# Currencies with no minor unit — mirrors `exponent: 0` in the app's
# SUPPORTED_CURRENCIES. Everything else is stored in hundredths.
_ZERO_DECIMAL = frozenset({"VND", "JPY", "KRW"})
_SYMBOLS = {"VND": "₫", "USD": "$", "EUR": "€", "JPY": "¥", "GBP": "£", "KRW": "₩"}


@dataclass(frozen=True)
class Candidate:
    """One active watchlist entry with a target and a current price."""

    id: str
    name: str
    target_minor: int
    currency: str
    price_minor: int
    price_currency: str
    alerted: bool
    """True when `target_alerted_at` is already set."""


@dataclass(frozen=True)
class Decision:
    to_alert: tuple[Candidate, ...]
    to_rearm: tuple[Candidate, ...]
    skipped: tuple[Candidate, ...]
    """Price and target are in different currencies — not comparable."""


@dataclass(frozen=True)
class Result:
    checked: int
    alerted: int
    rearmed: int
    skipped: int
    posted: bool
    """True only if a message was actually delivered."""


def decide(candidates: list[Candidate]) -> Decision:
    """Pure rule: which entries to alert on, re-arm, or skip."""
    to_alert: list[Candidate] = []
    to_rearm: list[Candidate] = []
    skipped: list[Candidate] = []
    for c in candidates:
        if c.price_currency != c.currency:
            skipped.append(c)
            continue
        at_target = c.price_minor <= c.target_minor
        if at_target and not c.alerted:
            to_alert.append(c)
        elif not at_target and c.alerted:
            to_rearm.append(c)
    return Decision(tuple(to_alert), tuple(to_rearm), tuple(skipped))


def format_money(minor: int, currency: str) -> str:
    """Human amount from minor units, e.g. 2964609 VND -> '₫2,964,609'."""
    symbol = _SYMBOLS.get(currency)
    prefix = symbol if symbol else f"{currency} "
    if currency in _ZERO_DECIMAL:
        return f"{prefix}{minor:,}"
    return f"{prefix}{minor / 100:,.2f}"


def _line(c: Candidate) -> str:
    now = format_money(c.price_minor, c.currency)
    target = format_money(c.target_minor, c.currency)
    if c.price_minor == c.target_minor:
        gap = "right at your target"
    else:
        below = (c.target_minor - c.price_minor) / c.target_minor * 100
        gap = f"{below:.1f}% below your target"
    return f"• *{c.name}* — now {now} ({gap} of {target})"


def build_message(alerts: tuple[Candidate, ...]) -> str:
    n = len(alerts)
    noun = "product has" if n == 1 else "products have"
    lines = [f"🎯 *Watchlist: {n} {noun} reached your buy target*", ""]
    lines.extend(_line(c) for c in alerts)
    return "\n".join(lines)


def fetch_candidates(conn: Connection[Any]) -> list[Candidate]:
    """Active, linked, targeted entries joined to their newest market price."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              w.id::text AS id,
              w.name,
              w.target_buy_price_cents AS target,
              w.currency,
              p.price_cents AS price,
              p.currency AS price_currency,
              (w.target_alerted_at IS NOT NULL) AS alerted
            FROM watchlist_items w
            JOIN LATERAL (
              SELECT price_cents, currency
              FROM market_prices m
              WHERE m.item_id = w.item_id
              ORDER BY m.fetched_at DESC
              LIMIT 1
            ) p ON true
            WHERE w.hit_at IS NULL
              AND w.item_id IS NOT NULL
              AND w.target_buy_price_cents IS NOT NULL
            ORDER BY w.name
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
            UPDATE watchlist_items
            SET target_alerted_at = CASE WHEN %s THEN now() ELSE NULL END
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
        log.warning("watchlist-alerts: webhook POST failed: %s", e)
        return False


def run(*, dry_run: bool = False, webhook_url: str | None = None) -> Result:
    """Check every targeted watchlist entry and alert on new crossings.

    `dry_run` prints what would be sent and changes nothing: no POST, no
    database writes.
    """
    url = webhook_url if webhook_url is not None else load_settings().alert_webhook_url

    with connection() as conn:
        candidates = fetch_candidates(conn)
        decision = decide(candidates)
        checked = len(candidates)

        for c in decision.skipped:
            log.info(
                "watchlist-alerts: skipping %r — target in %s but price in %s",
                c.name,
                c.currency,
                c.price_currency,
            )

        message = build_message(decision.to_alert) if decision.to_alert else None

        if dry_run:
            log.info("watchlist-alerts: dry run — nothing sent or written")
            print(message if message else "(no new alerts)")
            if decision.to_rearm:
                print(f"(would re-arm {len(decision.to_rearm)} entr(y/ies))")
            return Result(
                checked=checked,
                alerted=len(decision.to_alert),
                rearmed=len(decision.to_rearm),
                skipped=len(decision.skipped),
                posted=False,
            )

        # Re-arming is plain bookkeeping and needs no webhook.
        _set_alerted(conn, [c.id for c in decision.to_rearm], False)

        posted = False
        if message:
            if not url:
                log.warning(
                    "watchlist-alerts: %d entr(y/ies) reached target but "
                    "ALERT_WEBHOOK_URL is not set — will retry next run",
                    len(decision.to_alert),
                )
            elif _post(url, message):
                posted = True
                _set_alerted(conn, [c.id for c in decision.to_alert], True)
                log.info("watchlist-alerts: alerted on %d entr(y/ies)", len(decision.to_alert))

        return Result(
            checked=checked,
            alerted=len(decision.to_alert) if posted else 0,
            rearmed=len(decision.to_rearm),
            skipped=len(decision.skipped),
            posted=posted,
        )
