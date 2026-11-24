/**
 * Annualized return per position, on each starting basis. Pure reads (no
 * "use server").
 *
 * "My purchases" is worked out in the item's own currency from its buys and
 * sales (what is still held counts at today's market price where there is
 * one, at cost where there isn't, and paid-for stock still on its way at
 * cost, exactly as the dashboard does for the whole portfolio).
 *
 * The other bases measure the product's catalogue price (US dollars; a rate
 * has no currency) from the launch price or from 6 months / 1 year before its
 * newest price.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import type { ReturnEvent } from "@/lib/calc/annualized";
import {
  benchmarkLabel,
  chooseBenchmark,
  type BenchMode,
  type Benchmark,
} from "@/lib/calc/benchmark";
import type { IndexPoint } from "@/lib/calc/market_index";
import { pmeCompare, type PmeResult } from "@/lib/calc/pme";
import { sealedType, type SealedType } from "@/lib/calc/sealed_type";
import {
  priceReturn,
  purchaseReturn,
  type Basis,
  type PricePoint,
  type ReturnResult,
} from "@/lib/calc/position_return";
import { bulkReleaseDates } from "@/lib/calc/set_list";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import { getMarketIndexes } from "@/lib/server/catalog_insights";
import {
  listItemsWithValuations,
  type ItemWithValuation,
} from "@/lib/server/items";

export type PositionRow = {
  itemId: string;
  name: string;
  /** Units held now. */
  held: number;
  currency: string;
  /** Result for every basis. */
  results: Record<Basis, ReturnResult>;
  /** Buys and sells in another currency, left out of "my purchases". */
  skippedTx: number;
  /** The index it is compared with, and how it did against it. */
  bench: Benchmark | null;
  benchLabel: string | null;
  vsIndex: PmeResult;
  /** What the comparison was worked out from (item currency, minor units). */
  flow: {
    events: ReturnEvent[];
    terminal: number;
    series: ReadonlyArray<IndexPoint> | null;
  };
};

type AnchorRow = {
  product_id: string;
  rel: string | null;
  now_day: string | null;
  now_cents: number | null;
  rel_day: string | null;
  rel_cents: number | null;
  after_day: string | null;
  after_cents: number | null;
  m6_day: string | null;
  m6_cents: number | null;
  y1_day: string | null;
  y1_cents: number | null;
};

/** A newest price older than this, in days, isn't "now". */
const STALE_AFTER_DAYS = 7;
/** Look back this far from a target day for a price. */
const LOOKBACK_DAYS = 3;
const PERIOD_LOOKBACK_DAYS = 7;

type Anchors = {
  releasedOn: string | null;
  now: PricePoint | null;
  launch: PricePoint | null;
  m6: PricePoint | null;
  y1: PricePoint | null;
};

const point = (
  day: string | null,
  cents: number | string | null,
): PricePoint | null =>
  day != null && cents != null && Number(cents) > 0
    ? { day, cents: Number(cents) }
    : null;

/** Catalogue prices at the starting points, for each product. */
async function loadAnchors(
  productIds: ReadonlyArray<number>,
): Promise<Map<number, Anchors>> {
  const out = new Map<number, Anchors>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return out;
  const idsJson = JSON.stringify(ids);

  const rows = await db.execute<AnchorRow>(sql`
    WITH t AS (
      SELECT c.product_id, s.published_on::date AS rel
        FROM catalog_products c JOIN catalog_sets s ON s.group_id = c.group_id
       WHERE c.product_id IN (
         SELECT jsonb_array_elements_text(${idsJson}::jsonb)::bigint)
    ), latest AS (
      SELECT DISTINCT ON (p.product_id) p.product_id, p.day::date AS day,
             p.market_cents
        FROM catalog_prices p
       WHERE p.product_id IN (
         SELECT jsonb_array_elements_text(${idsJson}::jsonb)::bigint)
         AND p.market_cents > 0
       ORDER BY p.product_id, p.day DESC
    )
    SELECT t.product_id::text AS product_id,
           to_char(t.rel, 'YYYY-MM-DD') AS rel,
           to_char(l.day, 'YYYY-MM-DD') AS now_day, l.market_cents AS now_cents,
           to_char(r0.d, 'YYYY-MM-DD') AS rel_day, r0.c AS rel_cents,
           to_char(r1.d, 'YYYY-MM-DD') AS after_day, r1.c AS after_cents,
           to_char(m6.d, 'YYYY-MM-DD') AS m6_day, m6.c AS m6_cents,
           to_char(y1.d, 'YYYY-MM-DD') AS y1_day, y1.c AS y1_cents
      FROM t
      LEFT JOIN latest l ON l.product_id = t.product_id
      LEFT JOIN LATERAL (
        SELECT p.day::date AS d, p.market_cents AS c FROM catalog_prices p
         WHERE p.product_id = t.product_id AND p.market_cents > 0
           AND t.rel IS NOT NULL
           AND p.day <= t.rel AND p.day > t.rel - ${LOOKBACK_DAYS + 1}::int
         ORDER BY p.day DESC LIMIT 1) r0 ON true
      LEFT JOIN LATERAL (
        SELECT p.day::date AS d, p.market_cents AS c FROM catalog_prices p
         WHERE p.product_id = t.product_id AND p.market_cents > 0
           AND t.rel IS NOT NULL
           AND p.day > t.rel AND p.day <= t.rel + 7
         ORDER BY p.day ASC LIMIT 1) r1 ON true
      LEFT JOIN LATERAL (
        SELECT p.day::date AS d, p.market_cents AS c FROM catalog_prices p
         WHERE p.product_id = t.product_id AND p.market_cents > 0
           AND l.day IS NOT NULL
           AND p.day <= l.day - 182
           AND p.day > l.day - 182 - ${PERIOD_LOOKBACK_DAYS}::int
         ORDER BY p.day DESC LIMIT 1) m6 ON true
      LEFT JOIN LATERAL (
        SELECT p.day::date AS d, p.market_cents AS c FROM catalog_prices p
         WHERE p.product_id = t.product_id AND p.market_cents > 0
           AND l.day IS NOT NULL
           AND p.day <= l.day - 365
           AND p.day > l.day - 365 - ${PERIOD_LOOKBACK_DAYS}::int
         ORDER BY p.day DESC LIMIT 1) y1 ON true
  `);

  const newest = await db.execute<{ day: string | null }>(sql`
    SELECT to_char(max(day), 'YYYY-MM-DD') AS day FROM catalog_set_daily
  `);
  const newestDay = newest[0]?.day ?? null;

  // A date many sets share is a bookkeeping stamp, not a release.
  const dates = await db.execute<{ d: string | null }>(sql`
    SELECT to_char(published_on, 'YYYY-MM-DD') AS d FROM catalog_sets
  `);
  const bulk = bulkReleaseDates(dates.map((r) => r.d));

  for (const r of rows) {
    const fresh =
      r.now_day != null &&
      newestDay != null &&
      (Date.parse(newestDay) - Date.parse(r.now_day)) / 86_400_000 <=
        STALE_AFTER_DAYS;
    const releasedOn = r.rel && !bulk.has(r.rel) ? r.rel : null;
    out.set(Number(r.product_id), {
      releasedOn,
      now: fresh ? point(r.now_day, r.now_cents) : null,
      // The price on release day, else the first one in the following week.
      launch: releasedOn
        ? (point(r.rel_day, r.rel_cents) ?? point(r.after_day, r.after_cents))
        : null,
      m6: point(r.m6_day, r.m6_cents),
      y1: point(r.y1_day, r.y1_cents),
    });
  }
  return out;
}

type ProductMeta = { kind: SealedType | null; language: "en" | "ja" };

/** Kind and language of each linked catalogue product. */
async function loadProductMeta(
  productIds: ReadonlyArray<number>,
): Promise<Map<number, ProductMeta>> {
  const out = new Map<number, ProductMeta>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return out;
  const rows = await db.execute<{
    product_id: string;
    name: string;
    language: string;
  }>(sql`
    SELECT c.product_id::text AS product_id, c.name, s.language
      FROM catalog_products c JOIN catalog_sets s ON s.group_id = c.group_id
     WHERE c.product_id IN (
       SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::bigint)
  `);
  for (const r of rows) {
    out.set(Number(r.product_id), {
      kind: sealedType(r.name),
      language: r.language === "ja" ? "ja" : "en",
    });
  }
  return out;
}

async function buildRows(
  keep: (i: ItemWithValuation) => boolean,
  now: Date,
  mode: BenchMode = "match",
): Promise<PositionRow[]> {
  const [all, txs] = await Promise.all([
    listItemsWithValuations(),
    db.select().from(transactions),
  ]);
  const wanted = all.filter(keep);
  const byItem = new Map<string, typeof txs>();
  for (const t of txs) {
    const list = byItem.get(t.itemId) ?? [];
    list.push(t);
    byItem.set(t.itemId, list);
  }
  const linked = wanted
    .map((i) => i.item.catalogProductId)
    .filter((id): id is number => id != null)
    .map(Number);
  const [anchors, metas, indexes] = await Promise.all([
    loadAnchors(linked),
    loadProductMeta(linked),
    getMarketIndexes(),
  ]);
  const seriesBy = new Map<string, ReadonlyArray<IndexPoint>>(
    indexes.series.map((x) => [`${x.metric}:${x.language}`, x.points]),
  );

  return wanted.map(({ item, valuation }) => {
    const held = valuation.quantity;
    const currency = valuation.currency || "";

    // --- my purchases, in the item's own currency
    const mine = (byItem.get(item.id) ?? []).filter(
      (t) => !currency || t.currency === currency,
    );
    const skippedTx = (byItem.get(item.id) ?? []).length - mine.length;
    const events: ReturnEvent[] = mine.map((t) => ({
      at: t.occurredAt,
      type: t.type,
      amount: t.finalValueCents,
    }));
    const terminal =
      (held > 0
        ? valuation.marketPriceCents != null
          ? valuation.marketValueCents
          : valuation.inventoryCostCents
        : 0) + valuation.pendingCostCents;
    const purchase = purchaseReturn(events, terminal, now);

    // --- the same money in the market index
    const meta =
      item.catalogProductId != null
        ? (metas.get(Number(item.catalogProductId)) ?? null)
        : null;
    const bench = chooseBenchmark(
      mode,
      meta?.kind ?? null,
      meta?.language ?? null,
      (m, l) => seriesBy.has(`${m}:${l}`),
    );
    const series = bench
      ? (seriesBy.get(`${bench.metric}:${bench.language}`) ?? null)
      : null;
    const vsIndex = pmeCompare(
      events.map((e) => ({ ...e, series })),
      terminal,
      now,
    );

    // --- the product's own price path
    const a =
      item.catalogProductId != null
        ? (anchors.get(Number(item.catalogProductId)) ?? null)
        : null;
    const priceBasis = (
      basis: Basis,
      entry: PricePoint | null,
    ): ReturnResult => {
      if (held <= 0 && valuation.pendingQuantity <= 0) {
        return { status: "unavailable", basis, reason: "not_held" };
      }
      if (!a) return { status: "unavailable", basis, reason: "not_linked" };
      if (basis === "launch" && !a.releasedOn) {
        return { status: "unavailable", basis, reason: "no_release_date" };
      }
      return priceReturn(basis, entry, a.now);
    };

    return {
      itemId: item.id,
      name: item.name,
      held,
      currency,
      skippedTx,
      bench,
      benchLabel: bench ? benchmarkLabel(bench) : null,
      vsIndex,
      flow: { events, terminal, series },
      results: {
        purchase,
        launch: priceBasis("launch", a?.launch ?? null),
        "6m": priceBasis("6m", a?.m6 ?? null),
        "1y": priceBasis("1y", a?.y1 ?? null),
      },
    };
  });
}

/** Every position you hold or have on the way, on every basis. */
export async function getPositionReturns(now: Date): Promise<PositionRow[]> {
  return buildRows(
    (i) => i.valuation.quantity > 0 || i.valuation.pendingQuantity > 0,
    now,
  );
}

/** One item's result on every basis (the item page). */
export async function getItemReturns(
  itemId: string,
  now: Date,
): Promise<PositionRow | null> {
  const rows = await buildRows((i) => i.item.id === itemId, now);
  return rows[0] ?? null;
}

export type StockVsMarket = {
  currency: CurrencyCode;
  /** Every position with activity, held or closed. */
  rows: PositionRow[];
  /** All of it together, in the display currency. */
  total: PmeResult;
  /** Buys and sells left out for lack of an exchange rate. */
  skipped: number;
  /**
   * Share (0–1) of what you spent that was compared with an index for its own
   * kind of product; the rest used the all-sealed index. Null when every
   * position is compared with the all-sealed index by choice.
   */
  matchedShare: number | null;
};

/**
 * Your whole stock against the market index, and each position against its
 * own. Closed positions count too: the comparison is about everything you
 * traded. Amounts in another currency are converted at today's rate, as the
 * dashboard's annualized card does.
 */
export async function getStockVsMarket(
  now: Date,
  displayCurrency: CurrencyCode,
  mode: BenchMode,
): Promise<StockVsMarket> {
  const rows = await buildRows(() => true, now, mode);
  const active = rows.filter((r) => r.flow.events.length > 0);

  const rates = new Map<string, number>();
  await Promise.all(
    [...new Set(active.map((r) => r.currency))]
      .filter((c) => c && c !== displayCurrency)
      .map(async (c) => {
        try {
          rates.set(c, (await getRate(c as CurrencyCode, displayCurrency)).rate);
        } catch {
          // left out below
        }
      }),
  );
  const toDisplay = (amount: number, currency: string): number | null => {
    if (!currency || currency === displayCurrency) return amount;
    const rate = rates.get(currency);
    return rate == null
      ? null
      : convertMinor(amount, currency, displayCurrency, rate);
  };

  let skipped = 0;
  let terminal = 0;
  let spent = 0;
  let spentMatched = 0;
  const events: Parameters<typeof pmeCompare>[0][number][] = [];
  for (const r of active) {
    const t = toDisplay(r.flow.terminal, r.currency);
    if (t == null) {
      skipped += r.flow.events.length;
      continue;
    }
    terminal += t;
    for (const e of r.flow.events) {
      const amount = toDisplay(e.amount, r.currency);
      if (amount == null) skipped += 1;
      else {
        events.push({ ...e, amount, series: r.flow.series });
        if (e.type === "buy") {
          spent += amount;
          if (r.bench && r.bench.metric !== "sealed_all") spentMatched += amount;
        }
      }
    }
  }
  return {
    currency: displayCurrency,
    rows: active,
    total: pmeCompare(events, terminal, now),
    skipped,
    matchedShare: mode === "match" && spent > 0 ? spentMatched / spent : null,
  };
}
