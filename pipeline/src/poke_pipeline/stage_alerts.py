"""Daily "usual low" alerts for watched products.

A watchlist entry can opt in (``stage_alert``) to be told when its product
reaches the age at which earlier launches of the same kind have typically been
at their lowest price. The web app shows the same figure on the watchlist; this
module does the checking on a schedule and posts one webhook message.

What "usual low" means (a port of ``src/lib/calc/usual_low.ts``, checked
against it in ``tests/test_stage_alerts.py``):

- For one kind of product (booster box, Elite Trainer Box, bundle, pack) and
  one language, take every set released while the price history was being
  collected. Each product's price at fixed ages is compared with its price at
  day 7; a set counts once per kind (the median of its products); the typical
  change at an age is the median across sets.
- The usual low is the age, between day 7 and a year, with the lowest typical
  change among ages that at least 8 sets reached, but only if that dip is at
  least 5% below the day-7 price. A kind with no consistent dip has no usual
  low and nothing is ever sent for it.

Rules, chosen to be quiet rather than chatty:

- **One alert per product.** A product only ever gets older, so once it has
  been inside the window around its usual low (14 days either side) and the
  alert went out, ``stage_alerted_at`` is set and it never fires again.
- **A webhook failure loses nothing.** Entries are marked alerted only after
  the POST succeeds, so a failed run is retried by the next one.
- **Only what is known.** The entry must be linked to an item that is linked
  to a catalogue product with a recent price and a trustworthy release date.
  Anything else is skipped and counted, never guessed at.

The message describes what earlier launches did. It is not a recommendation.
"""

from __future__ import annotations

import logging
import math
import statistics
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx
from psycopg import Connection

from poke_pipeline.config import load_settings
from poke_pipeline.db import connection
from poke_pipeline.sealed_type import SEALED_TYPE_LABELS, SealedType, sealed_type

log = logging.getLogger(__name__)

# ── the usual-low rule (keep in step with src/lib/calc/usual_low.ts) ─────

LOW_BASE_AGE = 7
LOW_MAX_AGE = 365
LOW_MIN_SETS = 8
LOW_MIN_DIP = 0.05
LOW_WINDOW_DAYS = 14

# Ages prices are looked up at, from day 7 to a year (a subset of the app's
# grid: the part the usual low is searched over).
LOOKUP_AGES: tuple[int, ...] = (7, 14, 21, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 365)
# A price is "at" an age if it's the latest one on that day or the 3 before.
LOOKBACK_DAYS = 3
# A date this many sets share is a bookkeeping stamp, not a release.
BULK_DATE_THRESHOLD = 10
# A newest price older than this, in days, isn't "now".
STALE_AFTER_DAYS = 7


@dataclass(frozen=True)
class Low:
    age: int
    median: float
    p25: float
    p75: float
    sets: int


@dataclass(frozen=True)
class ProductAges:
    """One tracked product's price (US cents) at each lookup age."""

    group_id: int
    kind: SealedType
    language: str
    prices: Mapping[int, int | None]


def quantile(values: list[float], q: float) -> float:
    """Linear-interpolated quantile; the same formula as the app's."""
    s = sorted(values)
    pos = (len(s) - 1) * min(1.0, max(0.0, q))
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def usual_lows(products: Iterable[ProductAges]) -> dict[tuple[str, str], Low]:
    """The usual low for each (kind, language) that has one."""
    groups: dict[tuple[str, str], list[ProductAges]] = defaultdict(list)
    for p in products:
        groups[(p.kind, p.language)].append(p)

    out: dict[tuple[str, str], Low] = {}
    for key, members in groups.items():
        best: Low | None = None
        for age in LOOKUP_AGES:
            if age <= LOW_BASE_AGE or age > LOW_MAX_AGE:
                continue
            by_set: dict[int, list[float]] = defaultdict(list)
            for p in members:
                base = p.prices.get(LOW_BASE_AGE)
                then = p.prices.get(age)
                if base is None or then is None or not (base > 0) or not (then > 0):
                    continue
                by_set[p.group_id].append(then / base - 1)
            per_set = [statistics.median(r) for r in by_set.values()]
            if len(per_set) < LOW_MIN_SETS:
                continue
            median = statistics.median(per_set)
            # Strictly lower wins; ties keep the earlier age.
            if best is None or median < best.median:
                best = Low(
                    age=age,
                    median=median,
                    p25=quantile(per_set, 0.25),
                    p75=quantile(per_set, 0.75),
                    sets=len(per_set),
                )
        if best is not None and best.median <= -LOW_MIN_DIP:
            out[key] = best
    return out


def bulk_dates(dates: Iterable[str | None], threshold: int = BULK_DATE_THRESHOLD) -> set[str]:
    """Dates that too many sets share to be real release dates."""
    counts: dict[str, int] = defaultdict(int)
    for d in dates:
        if d:
            counts[d] += 1
    return {d for d, n in counts.items() if n >= threshold}


# ── decisions ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Candidate:
    """One opted-in, not-yet-alerted watchlist entry with a known product age."""

    id: str
    name: str
    product_name: str
    language: str
    age_days: int | None
    """Days since release at the product's newest price; None if unknown."""
    own_change: float | None
    """Its own change since day 7, when both prices are known."""


@dataclass(frozen=True)
class Decision:
    to_alert: tuple[tuple[Candidate, SealedType, Low], ...]
    skipped: tuple[Candidate, ...]
    """No known age, a kind with no usual low, or not a tracked kind."""


def at_low(age_days: int, low: Low) -> bool:
    return abs(age_days - low.age) <= LOW_WINDOW_DAYS


def decide(candidates: Iterable[Candidate], lows: Mapping[tuple[str, str], Low]) -> Decision:
    """Pure rule: which entries are at the usual low for their kind now."""
    to_alert: list[tuple[Candidate, SealedType, Low]] = []
    skipped: list[Candidate] = []
    for c in candidates:
        kind = sealed_type(c.product_name)
        low = lows.get((kind, c.language)) if kind else None
        if kind is None or low is None or c.age_days is None:
            skipped.append(c)
            continue
        if at_low(c.age_days, low):
            to_alert.append((c, kind, low))
    return Decision(tuple(to_alert), tuple(skipped))


# ── message ──────────────────────────────────────────────────────────────


def pct(f: float) -> str:
    """0.123 -> '+12.3%', -0.04 -> '-4.0%' (written with a real minus sign)."""
    sign = "+" if f > 0 else "\N{MINUS SIGN}" if f < 0 else ""
    return f"{sign}{abs(f) * 100:.1f}%"


def _age_phrase(days: int) -> str:
    if days < 14:
        return f"{days} days old"
    if days < 60:
        return f"{round(days / 7)} weeks old"
    return f"{round(days / 30.4)} months old"


def _line(c: Candidate, kind: SealedType, low: Low) -> str:
    assert c.age_days is not None
    label = SEALED_TYPE_LABELS[kind]
    own = f" It is {pct(c.own_change)} since day {LOW_BASE_AGE}." if c.own_change is not None else ""
    return (
        f"• *{c.name}* — day {c.age_days} ({_age_phrase(c.age_days)}). {label} have usually "
        f"been lowest around day {low.age} ({pct(low.median)} from day {LOW_BASE_AGE}; the middle "
        f"half of sets between {pct(low.p25)} and {pct(low.p75)}, {low.sets} sets).{own}"
    )


def build_message(alerts: Iterable[tuple[Candidate, SealedType, Low]]) -> str:
    items = list(alerts)
    n = len(items)
    noun = "product has" if n == 1 else "products have"
    lines = [f"📉 *Watchlist: {n} {noun} reached the usual low point for its kind*", ""]
    lines.extend(_line(*a) for a in items)
    lines += ["", "_What earlier launches did, not a recommendation._"]
    return "\n".join(lines)


# ── data ─────────────────────────────────────────────────────────────────


def fetch_lows(conn: Connection[Any]) -> dict[tuple[str, str], Low]:
    """The usual low per kind and language, from the stored price history."""
    with conn.cursor() as cur:
        cur.execute("SELECT to_char(published_on, 'YYYY-MM-DD') AS d FROM catalog_sets")
        bulk = bulk_dates(r["d"] for r in cur.fetchall())
        cur.execute(
            """
            SELECT max(day)::date AS last_day, min(day)::date AS first_day
              FROM catalog_set_daily
            """
        )
        bounds = cur.fetchone()
        if not bounds or bounds["last_day"] is None:
            return {}
        cur.execute(
            """
            SELECT c.product_id, c.group_id, c.name, s.language,
                   to_char(s.published_on, 'YYYY-MM-DD') AS rel
              FROM catalog_products c JOIN catalog_sets s ON s.group_id = c.group_id
             WHERE c.kind = 'sealed' AND s.published_on IS NOT NULL
               AND s.published_on::date BETWEEN %s AND %s
            """,
            (bounds["first_day"], bounds["last_day"]),
        )
        tracked: dict[int, tuple[int, SealedType, str]] = {}
        for r in cur.fetchall():
            if r["rel"] in bulk:
                continue
            kind = sealed_type(r["name"])
            if kind is not None:
                tracked[int(r["product_id"])] = (int(r["group_id"]), kind, r["language"])
        if not tracked:
            return {}
        cur.execute(
            """
            SELECT c.product_id, a.age,
                   (SELECT p.market_cents FROM catalog_prices p
                     WHERE p.product_id = c.product_id AND p.market_cents > 0
                       AND p.day <= (s.published_on::date + a.age)
                       AND p.day > (s.published_on::date + a.age - %s)
                     ORDER BY p.day DESC LIMIT 1) AS cents
              FROM catalog_products c
              JOIN catalog_sets s ON s.group_id = c.group_id
              CROSS JOIN unnest(%s::int[]) AS a(age)
             WHERE c.product_id = ANY(%s::bigint[])
               AND s.published_on::date + a.age <= %s
            """,
            (LOOKBACK_DAYS + 1, list(LOOKUP_AGES), list(tracked), bounds["last_day"]),
        )
        prices: dict[int, dict[int, int | None]] = defaultdict(dict)
        for r in cur.fetchall():
            prices[int(r["product_id"])][int(r["age"])] = (
                int(r["cents"]) if r["cents"] is not None else None
            )
    return usual_lows(
        ProductAges(group_id=g, kind=k, language=lang, prices=prices.get(pid, {}))
        for pid, (g, k, lang) in tracked.items()
    )


def fetch_candidates(conn: Connection[Any]) -> list[Candidate]:
    """Opted-in, active, not-yet-alerted entries with a catalogue product."""
    with conn.cursor() as cur:
        cur.execute("SELECT to_char(published_on, 'YYYY-MM-DD') AS d FROM catalog_sets")
        bulk = bulk_dates(r["d"] for r in cur.fetchall())
        cur.execute("SELECT max(day)::date AS newest FROM catalog_set_daily")
        newest_row = cur.fetchone()
        newest: date | None = newest_row["newest"] if newest_row else None
        cur.execute(
            """
            SELECT w.id::text AS id, w.name, c.name AS product_name, s.language,
                   to_char(s.published_on, 'YYYY-MM-DD') AS rel,
                   s.published_on::date AS rel_date,
                   l.day AS latest_day, l.cents AS latest_cents,
                   b.cents AS base_cents
              FROM watchlist_items w
              JOIN items i ON i.id = w.item_id
              JOIN catalog_products c ON c.product_id = i.catalog_product_id
              JOIN catalog_sets s ON s.group_id = c.group_id
              LEFT JOIN LATERAL (
                SELECT p.day::date AS day, p.market_cents AS cents
                  FROM catalog_prices p
                 WHERE p.product_id = c.product_id AND p.market_cents > 0
                 ORDER BY p.day DESC LIMIT 1) l ON true
              LEFT JOIN LATERAL (
                SELECT p.market_cents AS cents
                  FROM catalog_prices p
                 WHERE p.product_id = c.product_id AND p.market_cents > 0
                   AND s.published_on IS NOT NULL
                   AND p.day <= (s.published_on::date + %s)
                   AND p.day > (s.published_on::date + %s - %s)
                 ORDER BY p.day DESC LIMIT 1) b ON true
             WHERE w.stage_alert AND w.stage_alerted_at IS NULL
               AND w.hit_at IS NULL AND w.item_id IS NOT NULL
             ORDER BY w.name
            """,
            (LOW_BASE_AGE, LOW_BASE_AGE, LOOKBACK_DAYS + 1),
        )
        rows = cur.fetchall()

    out: list[Candidate] = []
    for r in rows:
        fresh = (
            r["latest_day"] is not None
            and newest is not None
            and (newest - r["latest_day"]).days <= STALE_AFTER_DAYS
        )
        usable_date = r["rel"] is not None and r["rel"] not in bulk
        age = (r["latest_day"] - r["rel_date"]).days if fresh and usable_date else None
        own = None
        if age is not None and age > LOW_BASE_AGE and r["base_cents"] and r["latest_cents"]:
            own = int(r["latest_cents"]) / int(r["base_cents"]) - 1
        out.append(
            Candidate(
                id=r["id"],
                name=r["name"],
                product_name=r["product_name"],
                language=r["language"],
                age_days=age,
                own_change=own,
            )
        )
    return out


def _set_alerted(conn: Connection[Any], ids: list[str]) -> None:
    if not ids:
        return
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE watchlist_items SET stage_alerted_at = now() WHERE id = ANY(%s::uuid[])",
            (ids,),
        )


def _post(webhook_url: str, text: str) -> bool:
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(webhook_url, json={"text": text, "content": text})
            r.raise_for_status()
        return True
    except Exception as e:
        log.warning("stage-alerts: webhook POST failed: %s", e)
        return False


@dataclass(frozen=True)
class Result:
    checked: int
    alerted: int
    skipped: int
    posted: bool
    """True only if a message was actually delivered."""


def run(*, dry_run: bool = False, webhook_url: str | None = None) -> Result:
    """Check every opted-in entry and alert on those at their usual low.

    ``dry_run`` prints what would be sent and changes nothing.
    """
    url = webhook_url if webhook_url is not None else load_settings().alert_webhook_url

    with connection() as conn:
        candidates = fetch_candidates(conn)
        if not candidates:
            return Result(checked=0, alerted=0, skipped=0, posted=False)
        lows = fetch_lows(conn)
        decision = decide(candidates, lows)

        for c in decision.skipped:
            log.info("stage-alerts: skipping %r — no age, kind or usual low to compare", c.name)

        message = build_message(decision.to_alert) if decision.to_alert else None

        if dry_run:
            log.info("stage-alerts: dry run — nothing sent or written")
            print(message if message else "(no new stage alerts)")
            return Result(
                checked=len(candidates),
                alerted=len(decision.to_alert),
                skipped=len(decision.skipped),
                posted=False,
            )

        posted = False
        if message:
            if not url:
                log.warning(
                    "stage-alerts: %d entr(y/ies) at their usual low but ALERT_WEBHOOK_URL "
                    "is not set — will retry next run",
                    len(decision.to_alert),
                )
            elif _post(url, message):
                posted = True
                _set_alerted(conn, [c.id for c, _, _ in decision.to_alert])
                log.info("stage-alerts: alerted on %d entr(y/ies)", len(decision.to_alert))

        return Result(
            checked=len(candidates),
            alerted=len(decision.to_alert) if posted else 0,
            skipped=len(decision.skipped),
            posted=posted,
        )
