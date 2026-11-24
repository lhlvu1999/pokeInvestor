"""Catalogue sync: every English and Japanese Pokémon set, its sealed products
and their prices, from the public TCGCSV mirror of TCGplayer.

What is stored, and what deliberately is not
--------------------------------------------
- Sets and products (names, kind, rarity, image) — metadata only.
- A **daily price for each sealed product** (booster boxes, ETBs, tins...).
- **Per-set daily totals**: total value, top-10 and top-20 value, and how many
  cards are priced.
- A set's **top-20 cards, snapshotted weekly**.
- Individual card prices are *not* stored. A page that needs one set's full
  card list fetches it live (see the web app's catalogue API).

A card counts at its **highest market price across its printings** (normal,
holo, reverse holo, 1st edition...), so a set total reads "one of each card,
best version". The rule lives in `best_price` so it can be changed in one place.

Politeness
----------
TCGCSV is a one-person hobby site. The daily run reads ONE archive file
(about 4 MB, all games) for prices instead of ~1,400 per-set requests, sends
an identifiable User-Agent, and spaces the product-list requests it does need
(only for sets it hasn't seen, recent sets, and sets whose products changed).

Idempotent: every write is an upsert, so re-running a day is safe.
"""

from __future__ import annotations

import logging
import tempfile
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import py7zr
from py7zr.io import BytesIOFactory

from poke_pipeline.db import connection

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping, Sequence

    from psycopg import Connection

log = logging.getLogger(__name__)

BASE_URL = "https://tcgcsv.com"
USER_AGENT = "poke-investor-pipeline/0.1 (personal tool; one archive file a day, polite)"
# TCGplayer category ids -> language.
CATEGORIES: dict[int, str] = {3: "en", 85: "ja"}
REQUEST_DELAY_SEC = 0.25

TOP_N = 20
TOP_SNAPSHOT_EVERY_DAYS = 7
# Sets this young may still be gaining products; re-read them daily.
RECENT_SET_DAYS = 120
# Everything else is re-read at least this often, to catch renamed products.
STALE_PRODUCTS_DAYS = 30
# Cap on product-list fetches in one run; a first run covers ~685 sets.
DEFAULT_MAX_SETS = 1000


# ── Pure rules ─────────────────────────────────────────────────────────────


def cents(value: object) -> int | None:
    """US dollars (float) to whole cents. None for missing or nonsensical."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    if value != value or value < 0:  # NaN or negative
        return None
    return round(value * 100)


@dataclass(frozen=True)
class PriceRow:
    """One TCGplayer price row: a product in one printing."""

    product_id: int
    variant: str | None
    market: int | None
    low: int | None
    mid: int | None
    high: int | None


def parse_price_rows(results: Iterable[Mapping[str, Any]]) -> dict[int, list[PriceRow]]:
    """Group a prices file's rows by product, converting dollars to cents."""
    out: dict[int, list[PriceRow]] = {}
    for r in results:
        pid = r.get("productId")
        if not isinstance(pid, int):
            continue
        out.setdefault(pid, []).append(
            PriceRow(
                product_id=pid,
                variant=r.get("subTypeName") if isinstance(r.get("subTypeName"), str) else None,
                market=cents(r.get("marketPrice")),
                low=cents(r.get("lowPrice")),
                mid=cents(r.get("midPrice")),
                high=cents(r.get("highPrice")),
            )
        )
    return out


def best_price(rows: Sequence[PriceRow]) -> PriceRow | None:
    """The row that represents the product: highest market price.

    A card is sold in several printings; its value for ranking and set totals
    is its best printing's market price. Rows with no market price are
    ignored; `None` if none has one.
    """
    priced = [r for r in rows if r.market is not None]
    if not priced:
        return None
    return max(priced, key=lambda r: r.market or 0)


def classify_product(raw: Mapping[str, Any]) -> str:
    """'card' if it has a card number or rarity, else 'sealed'.

    Anything that isn't a card (boxes, packs, tins, binders, sleeves...) is
    'sealed': the catalogue treats it as a product you could hold.
    """
    names = {
        e.get("name")
        for e in raw.get("extendedData", []) or []
        if isinstance(e, dict)
    }
    return "card" if ("Number" in names or "Rarity" in names) else "sealed"


def extended_value(raw: Mapping[str, Any], name: str) -> str | None:
    for e in raw.get("extendedData", []) or []:
        if isinstance(e, dict) and e.get("name") == name:
            v = e.get("value")
            return v if isinstance(v, str) and v != "" else None
    return None


@dataclass(frozen=True)
class TopCard:
    product_id: int
    market: int
    variant: str | None


@dataclass(frozen=True)
class SetAggregate:
    card_count: int
    priced_count: int
    total: int
    top10: int
    top20: int
    top: tuple[TopCard, ...]


def aggregate_set(
    card_ids: Iterable[int],
    prices: Mapping[int, Sequence[PriceRow]],
    *,
    top_n: int = TOP_N,
) -> SetAggregate:
    """Totals and the most valuable cards of one set.

    `card_ids` are the set's cards (so unpriced cards count in `card_count`
    but add nothing). Ties in value are broken by product id, so the order is
    the same on every run.
    """
    ids = list(card_ids)
    valued: list[TopCard] = []
    for pid in ids:
        best = best_price(prices.get(pid, ()))
        if best is not None and best.market is not None:
            valued.append(TopCard(pid, best.market, best.variant))
    valued.sort(key=lambda c: (-c.market, c.product_id))
    return SetAggregate(
        card_count=len(ids),
        priced_count=len(valued),
        total=sum(c.market for c in valued),
        top10=sum(c.market for c in valued[:10]),
        top20=sum(c.market for c in valued[:20]),
        top=tuple(valued[:top_n]),
    )


def needs_products_refresh(
    *,
    synced_at: datetime | None,
    published_on: date | None,
    has_unknown_products: bool,
    now: datetime,
) -> bool:
    """Whether to re-read a set's product list this run.

    Yes when never read, when the archive shows a product we don't know,
    when the set is young enough to still be gaining products (read daily),
    or when the list is a month old.
    """
    if synced_at is None or has_unknown_products:
        return True
    age = now - synced_at
    if published_on is not None and (now.date() - published_on) <= timedelta(days=RECENT_SET_DAYS):
        return age >= timedelta(hours=20)
    return age >= timedelta(days=STALE_PRODUCTS_DAYS)


def should_snapshot_top(last_snapshot: date | None, today: date) -> bool:
    """Weekly cadence for the top-20 list; always when none exists yet."""
    return last_snapshot is None or (today - last_snapshot).days >= TOP_SNAPSHOT_EVERY_DAYS


def archive_url(day: date) -> str:
    return f"{BASE_URL}/archive/tcgplayer/prices-{day.isoformat()}.ppmd.7z"


def candidate_archive_days(now: datetime) -> list[date]:
    """Today's archive (published ~20:00 UTC) if it's there, else yesterday's."""
    d = now.astimezone(UTC).date()
    return [d, d - timedelta(days=1)]


def parse_published(raw: object) -> date | None:
    if not isinstance(raw, str) or len(raw) < 10:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


# ── Archive reading ────────────────────────────────────────────────────────


def read_archive_prices(
    path: Path, day: date, categories: Iterable[int] = CATEGORIES
) -> dict[tuple[int, int], list[dict[str, Any]]]:
    """All price rows for the wanted categories, keyed (category, group).

    Reads only those entries of the archive, in memory.
    """
    import json

    prefixes = tuple(f"{day.isoformat()}/{c}/" for c in categories)
    out: dict[tuple[int, int], list[dict[str, Any]]] = {}
    with py7zr.SevenZipFile(path) as z:
        wanted = [n for n in z.getnames() if n.startswith(prefixes) and n.endswith("/prices")]
        factory = BytesIOFactory(limit=100 * 1024 * 1024)
        z.extract(targets=wanted, factory=factory)
        for name, buf in factory.products.items():
            parts = name.split("/")
            if len(parts) != 4:
                continue
            try:
                cat, grp = int(parts[1]), int(parts[2])
                payload = json.loads(buf.read().decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                continue
            results = payload.get("results") if isinstance(payload, dict) else None
            if isinstance(results, list):
                out[(cat, grp)] = results
    return out


# ── HTTP ───────────────────────────────────────────────────────────────────


def retry_after_seconds(header: str | None, attempt: int) -> float:
    """How long to wait after HTTP 429.

    The server's `Retry-After` (seconds) if it gives one, else a pause that
    grows with each attempt (15s, 30s, 45s...). Always capped, so a bad header
    can't stall a run for hours.
    """
    cap = 180.0
    if header and header.strip().isdigit():
        return min(float(header.strip()), cap)
    return min(15.0 * (attempt + 1), cap)


class Client:
    """Small polite client: identifiable UA, spacing, a couple of retries."""

    def __init__(
        self,
        delay: float = REQUEST_DELAY_SEC,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._http = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=60.0,
            follow_redirects=True,
            transport=transport,
        )
        self._delay = delay

    def close(self) -> None:
        self._http.close()

    def get_json(self, path: str) -> Any | None:
        for attempt in range(3):
            try:
                r = self._http.get(f"{BASE_URL}{path}")
                if r.status_code == 200:
                    time.sleep(self._delay)
                    return r.json()
                if r.status_code == 404:
                    return None
            except (httpx.HTTPError, ValueError) as e:
                log.debug("GET %s failed (%s)", path, e)
            time.sleep(1 + attempt)
        log.warning("catalog: giving up on %s", path)
        return None

    def archive_exists(self, day: date) -> bool:
        try:
            return self._http.head(archive_url(day)).status_code == 200
        except httpx.HTTPError:
            return False

    def fetch_archive(self, day: date, dest: Path, *, retries: int = 5) -> str:
        """Download a day's archive to `dest`.

        Returns "ok", "missing" (the site has no file for that day: a real
        gap, not worth retrying) or "error" (a problem that survived the
        retries, so the day should be tried again later).

        When the site says to slow down (HTTP 429) we wait as long as it asks
        (`Retry-After`), or a growing pause if it doesn't say, rather than
        hammering a one-person hobby site.
        """
        for attempt in range(retries):
            wait = 2.0 * (attempt + 1)
            try:
                with self._http.stream("GET", archive_url(day)) as r:
                    if r.status_code == 404:
                        return "missing"
                    if r.status_code == 200:
                        with dest.open("wb") as f:
                            for chunk in r.iter_bytes():
                                f.write(chunk)
                        return "ok"
                    if r.status_code == 429:
                        wait = retry_after_seconds(r.headers.get("Retry-After"), attempt)
                    log.warning(
                        "catalog: archive %s answered HTTP %s; waiting %.0fs",
                        day,
                        r.status_code,
                        wait,
                    )
            except httpx.HTTPError as e:
                log.warning("catalog: archive %s download failed: %s", day, e)
            time.sleep(wait)
        return "error"

    def download_archive(self, day: date, dest: Path) -> bool:
        return self.fetch_archive(day, dest) == "ok"


# ── Database ───────────────────────────────────────────────────────────────


def upsert_sets(conn: Connection[Any], rows: list[tuple[Any, ...]]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO catalog_sets
              (group_id, category_id, language, name, abbreviation, published_on)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (group_id) DO UPDATE SET
              category_id = EXCLUDED.category_id,
              language = EXCLUDED.language,
              name = EXCLUDED.name,
              abbreviation = EXCLUDED.abbreviation,
              published_on = EXCLUDED.published_on
            """,
            rows,
        )


def upsert_products(conn: Connection[Any], rows: list[tuple[Any, ...]]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO catalog_products
              (product_id, group_id, name, kind, rarity, card_number, image_url, url)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (product_id) DO UPDATE SET
              group_id = EXCLUDED.group_id,
              name = EXCLUDED.name,
              kind = EXCLUDED.kind,
              rarity = EXCLUDED.rarity,
              card_number = EXCLUDED.card_number,
              image_url = EXCLUDED.image_url,
              url = EXCLUDED.url
            """,
            rows,
        )


def known_products(conn: Connection[Any]) -> dict[int, dict[int, str]]:
    """group_id -> {product_id: kind} for every product already stored."""
    out: dict[int, dict[int, str]] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT group_id, product_id, kind FROM catalog_products")
        for r in cur.fetchall():
            out.setdefault(int(r["group_id"]), {})[int(r["product_id"])] = str(r["kind"])
    return out


# ── One day's rows ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class DayRows:
    """Everything one archive day contributes, ready to write."""

    sealed: list[tuple[Any, ...]]
    daily: list[tuple[Any, ...]]
    top: list[tuple[Any, ...]]
    skipped: int
    """Sets in the archive with no known products (so no totals)."""
    cards: list[tuple[Any, ...]] = field(default_factory=list)
    """Prices of the individual cards that slabs in the app are matched to."""


def compute_day(
    *,
    day: date,
    archive: Mapping[tuple[int, int], list[dict[str, Any]]],
    known: Mapping[int, Mapping[int, str]],
    set_ids: Iterable[int],
    wants_top: Callable[[int], bool],
    linked_cards: Iterable[int] = (),
) -> DayRows:
    """Turn one day's price files into rows, using the products we know.

    Shared by the daily sync and the historical backfill so both apply exactly
    the same rules. Prices for a product we don't know (for example one that
    TCGplayer has since removed) are skipped, so a historical set total is
    "the cards in the set today, at that day's prices".
    """
    sets = set(set_ids)
    sealed_rows: list[tuple[Any, ...]] = []
    daily_rows: list[tuple[Any, ...]] = []
    top_rows: list[tuple[Any, ...]] = []
    skipped = 0

    # Prices are looked up by PRODUCT across the whole day, not within the set
    # file a product happened to sit in: TCGplayer moves products between sets
    # over time, so an old archive can list a product under a different set
    # than today's. Each product then counts in the set it belongs to now.
    prices: dict[int, list[PriceRow]] = {}
    for results in archive.values():
        for pid, rows_ in parse_price_rows(results).items():
            prices.setdefault(pid, []).extend(rows_)

    for (_cat, gid), _results in archive.items():
        have = known.get(gid)
        if gid not in sets or not have:
            skipped += 1
            continue
        cards = [pid for pid, kind in have.items() if kind == "card"]
        agg = aggregate_set(cards, prices)
        daily_rows.append(
            (gid, day, agg.card_count, agg.priced_count, agg.total, agg.top10, agg.top20)
        )
        if agg.top and wants_top(gid):
            for rank, c in enumerate(agg.top, start=1):
                top_rows.append((gid, day, rank, c.product_id, c.market, c.variant))

    for gid, have in known.items():
        if gid not in sets:
            continue
        for pid, kind in have.items():
            if kind != "sealed" or pid not in prices:
                continue
            row = best_price(prices[pid]) or prices[pid][0]
            sealed_rows.append((pid, day, row.market, row.low, row.mid, row.high))
    # The cards that graded slabs are matched to: their raw price is kept too, so
    # a slab can be compared with the same card ungraded. Same rule as set
    # totals: the best printing's market price.
    card_rows: list[tuple[Any, ...]] = []
    for pid in sorted(set(linked_cards)):
        if pid not in prices:
            continue
        row = best_price(prices[pid]) or prices[pid][0]
        card_rows.append((pid, day, row.market, row.low, row.mid, row.high))
    return DayRows(sealed_rows, daily_rows, top_rows, skipped, card_rows)


def write_day(conn: Connection[Any], rows: DayRows) -> None:
    """Upsert one day's rows. Safe to repeat."""
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO catalog_prices
              (product_id, day, market_cents, low_cents, mid_cents, high_cents)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (product_id, day) DO UPDATE SET
              market_cents = EXCLUDED.market_cents, low_cents = EXCLUDED.low_cents,
              mid_cents = EXCLUDED.mid_cents, high_cents = EXCLUDED.high_cents
            """,
            rows.sealed + rows.cards,
        )
        cur.executemany(
            """
            INSERT INTO catalog_set_daily
              (group_id, day, card_count, priced_count, total_cents, top10_cents, top20_cents)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (group_id, day) DO UPDATE SET
              card_count = EXCLUDED.card_count, priced_count = EXCLUDED.priced_count,
              total_cents = EXCLUDED.total_cents, top10_cents = EXCLUDED.top10_cents,
              top20_cents = EXCLUDED.top20_cents
            """,
            rows.daily,
        )
        cur.executemany(
            """
            INSERT INTO catalog_set_top
              (group_id, day, rank, product_id, market_cents, variant)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (group_id, day, rank) DO UPDATE SET
              product_id = EXCLUDED.product_id, market_cents = EXCLUDED.market_cents,
              variant = EXCLUDED.variant
            """,
            rows.top,
        )


# ── The run ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Result:
    day: date
    sets: int
    sets_fetched: int
    sealed_prices: int
    set_rows: int
    top_rows: int
    skipped_sets: int
    """Sets with prices but no known products yet (over the per-run cap)."""


def _product_rows(group_id: int, products: Iterable[Mapping[str, Any]]) -> list[tuple[Any, ...]]:
    rows: list[tuple[Any, ...]] = []
    for p in products:
        pid = p.get("productId")
        name = p.get("name")
        if not isinstance(pid, int) or not isinstance(name, str):
            continue
        rows.append(
            (
                pid,
                group_id,
                name,
                classify_product(p),
                extended_value(p, "Rarity"),
                extended_value(p, "Number"),
                p.get("imageUrl") if isinstance(p.get("imageUrl"), str) else None,
                p.get("url") if isinstance(p.get("url"), str) else None,
            )
        )
    return rows


def run(
    *,
    day: date | None = None,
    max_sets: int = DEFAULT_MAX_SETS,
    now: datetime | None = None,
    client: Client | None = None,
) -> Result:
    """Sync the catalogue for one archive day (default: the newest published)."""
    now = now or datetime.now(UTC)
    http = client or Client()
    try:
        # 1. Which archive day.
        if day is None:
            for d in candidate_archive_days(now):
                if http.archive_exists(d):
                    day = d
                    break
            if day is None:
                raise RuntimeError("no price archive published for today or yesterday")
        log.info("catalog-sync: using archive %s", day)

        # 2. Sets (two small requests).
        set_rows: list[tuple[Any, ...]] = []
        for cat, lang in CATEGORIES.items():
            groups = http.get_json(f"/tcgplayer/{cat}/groups")
            for g in (groups or {}).get("results", []):
                gid = g.get("groupId")
                if isinstance(gid, int) and isinstance(g.get("name"), str):
                    ab = g.get("abbreviation")
                    set_rows.append(
                        (
                            gid,
                            cat,
                            lang,
                            g["name"],
                            ab if isinstance(ab, str) and ab else None,
                            parse_published(g.get("publishedOn")),
                        )
                    )
        if not set_rows:
            raise RuntimeError("TCGCSV returned no sets; leaving the catalogue untouched")
        with connection() as conn:
            upsert_sets(conn, set_rows)
        log.info("catalog-sync: %d sets", len(set_rows))

        # 3. Today's prices, one file.
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "prices.7z"
            if not http.download_archive(day, dest):
                raise RuntimeError(f"could not download the {day} price archive")
            archive = read_archive_prices(dest, day)
        log.info("catalog-sync: %d price files", len(archive))

        # 4. Which sets need their product list (re)read.
        with connection() as conn:
            known = known_products(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT group_id, category_id, products_synced_at, published_on FROM catalog_sets"
                )
                meta = {int(r["group_id"]): r for r in cur.fetchall()}
        todo: list[tuple[int, int]] = []
        for (cat, gid), results in archive.items():
            if gid not in meta:
                continue
            ids = {r.get("productId") for r in results if isinstance(r.get("productId"), int)}
            have = known.get(gid, {})
            published = meta[gid]["published_on"]
            if needs_products_refresh(
                synced_at=meta[gid]["products_synced_at"],
                published_on=published.date() if isinstance(published, datetime) else published,
                has_unknown_products=bool(ids - set(have)),
                now=now,
            ):
                todo.append((cat, gid))
        todo.sort(key=lambda t: t[1])
        fetching = todo[:max_sets]
        log.info("catalog-sync: reading product lists for %d sets", len(fetching))
        for cat, gid in fetching:
            payload = http.get_json(f"/tcgplayer/{cat}/{gid}/products")
            if payload is None:
                continue
            rows = _product_rows(gid, payload.get("results", []))
            with connection() as conn:
                upsert_products(conn, rows)
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE catalog_sets SET products_synced_at = %s WHERE group_id = %s",
                        (now, gid),
                    )

        # 5. Compute and store prices and aggregates.
        with connection() as conn:
            known = known_products(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT group_id, max(day) AS last FROM catalog_set_top GROUP BY group_id"
                )
                last_top = {int(r["group_id"]): r["last"] for r in cur.fetchall()}

            def wants_top(gid: int) -> bool:
                last = last_top.get(gid)
                last_d = last.date() if isinstance(last, datetime) else last
                return should_snapshot_top(last_d, day)

            with conn.cursor() as cur:
                cur.execute(
                    "SELECT DISTINCT raw_card_product_id AS pid FROM items "
                    "WHERE raw_card_product_id IS NOT NULL"
                )
                linked_cards = [int(r["pid"]) for r in cur.fetchall()]
            rows_for_day = compute_day(
                day=day,
                archive=archive,
                known=known,
                set_ids=set(meta),
                wants_top=wants_top,
                linked_cards=linked_cards,
            )
            write_day(conn, rows_for_day)
        sealed_rows = rows_for_day.sealed
        daily_rows = rows_for_day.daily
        top_rows = rows_for_day.top
        skipped = rows_for_day.skipped
        return Result(
            day=day,
            sets=len(set_rows),
            sets_fetched=len(fetching),
            sealed_prices=len(sealed_rows),
            set_rows=len(daily_rows),
            top_rows=len(top_rows),
            skipped_sets=skipped,
        )
    finally:
        if client is None:
            http.close()


# ── Historical backfill ────────────────────────────────────────────────────

# The first day TCGCSV archived prices.
BACKFILL_FIRST_DAY = date(2024, 2, 8)


def is_snapshot_day(day: date) -> bool:
    """Top-20 lists are kept for Sundays only when backfilling.

    The daily sync decides by "none in the last week"; for history, a fixed
    weekday gives the same weekly rhythm no matter what order days are done in.
    """
    return day.weekday() == 6


def plan_backfill_days(
    start: date,
    end: date,
    existing: Iterable[date],
    *,
    newest_first: bool = True,
    limit: int | None = None,
) -> list[date]:
    """The archive days still to load: [start, end] minus what is stored.

    Newest first by default, so the history that matters most (recent months)
    lands first and the job can be stopped at any time.
    """
    have = set(existing)
    days = [
        start + timedelta(days=i)
        for i in range((end - start).days + 1)
        if (start + timedelta(days=i)) not in have
    ]
    if newest_first:
        days.reverse()
    return days[:limit] if limit is not None else days


@dataclass(frozen=True)
class BackfillResult:
    planned: int
    loaded: int
    missing: list[date]
    """Days the site has no archive for."""
    failed: list[date]
    """Days that couldn't be downloaded; run again to retry them."""
    sealed_rows: int
    set_rows: int
    top_rows: int


def backfill(
    *,
    start: date = BACKFILL_FIRST_DAY,
    end: date | None = None,
    newest_first: bool = True,
    limit: int | None = None,
    delay: float = 2.0,
    now: datetime | None = None,
    client: Client | None = None,
) -> BackfillResult:
    """Load price history from the archive, one day at a time.

    Resumable: days already stored are skipped, and each day is written in one
    transaction, so stopping at any moment (or crashing) loses nothing and a
    re-run carries on. Uses the products already in the catalogue, so run
    `catalog-sync` first.
    """
    now = now or datetime.now(UTC)
    end = end or (now.astimezone(UTC).date() - timedelta(days=1))
    http = client or Client()
    try:
        with connection() as conn:
            known = known_products(conn)
            with conn.cursor() as cur:
                cur.execute("SELECT group_id FROM catalog_sets")
                set_ids = {int(r["group_id"]) for r in cur.fetchall()}
                cur.execute("SELECT DISTINCT day FROM catalog_set_daily")
                existing = {
                    r["day"].date() if isinstance(r["day"], datetime) else r["day"]
                    for r in cur.fetchall()
                }
                cur.execute(
                    "SELECT DISTINCT raw_card_product_id AS pid FROM items "
                    "WHERE raw_card_product_id IS NOT NULL"
                )
                linked_cards = [int(r["pid"]) for r in cur.fetchall()]
        if not known:
            raise RuntimeError("the catalogue has no products yet; run catalog-sync first")

        days = plan_backfill_days(start, end, existing, newest_first=newest_first, limit=limit)
        log.info("catalog-backfill: %d days to load (%s to %s)", len(days), start, end)
        loaded = 0
        missing: list[date] = []
        failed: list[date] = []
        totals = [0, 0, 0]
        for n, day in enumerate(days, start=1):
            with tempfile.TemporaryDirectory() as tmp:
                dest = Path(tmp) / "prices.7z"
                status = http.fetch_archive(day, dest)
                if status == "missing":
                    missing.append(day)
                    log.info("catalog-backfill: %s has no archive (%d/%d)", day, n, len(days))
                    continue
                if status == "error":
                    failed.append(day)
                    continue
                archive = read_archive_prices(dest, day)
            rows = compute_day(
                day=day,
                archive=archive,
                known=known,
                set_ids=set_ids,
                wants_top=lambda _gid, d=day: is_snapshot_day(d),
                linked_cards=linked_cards,
            )
            with connection() as conn:
                write_day(conn, rows)
            loaded += 1
            totals[0] += len(rows.sealed)
            totals[1] += len(rows.daily)
            totals[2] += len(rows.top)
            log.info(
                "catalog-backfill: %s %d sealed, %d sets, %d top (%d/%d)",
                day,
                len(rows.sealed),
                len(rows.daily),
                len(rows.top),
                n,
                len(days),
            )
            time.sleep(delay)
        return BackfillResult(
            planned=len(days),
            loaded=loaded,
            missing=missing,
            failed=failed,
            sealed_rows=totals[0],
            set_rows=totals[1],
            top_rows=totals[2],
        )
    finally:
        if client is None:
            http.close()
