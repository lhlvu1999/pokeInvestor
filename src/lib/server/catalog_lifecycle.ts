/**
 * Where specific catalogue products sit in their life: loads each product's
 * release date, newest price and price at fixed ages, then compares it with
 * earlier sets (see `calc/lifecycle`). Pure reads (no "use server").
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { AGES } from "@/lib/calc/age_curve";
import {
  buildLifecycle,
  type Lifecycle,
  type LifecycleInput,
} from "@/lib/calc/lifecycle";
import { sealedType } from "@/lib/calc/sealed_type";
import { costByPhase, type CostByPhase } from "@/lib/calc/stock_timing";
import type { CurrencyCode } from "@/lib/currency";
import { bulkReleaseDates } from "@/lib/calc/set_list";
import { getAgedProducts } from "@/lib/server/catalog_insights";
import { getDashboardData } from "@/lib/server/portfolio";

export type ProductLifecycle = Lifecycle & {
  productId: number;
  name: string;
  setName: string;
  releasedOn: string | null;
};

/** A newest price older than this, in days, no longer says where it is now. */
const STALE_AFTER_DAYS = 7;

/** Look back at most this many days from a target age for a price. */
const AGE_TOLERANCE_DAYS = 3;

type MetaRow = {
  product_id: string;
  group_id: string;
  name: string;
  set_name: string;
  language: string;
  rel: string | null;
  prices: Array<number | string | null>;
};

type LatestRow = { product_id: string; day: string; market_cents: number };

/** A product's raw lifecycle inputs, with the names to show for it. */
export type ProductInput = {
  productId: number;
  name: string;
  setName: string;
  input: LifecycleInput;
};

/** Release date, newest price and price at fixed ages for each product. */
export async function loadLifecycleInputs(
  productIds: ReadonlyArray<number>,
): Promise<ProductInput[]> {
  const out: ProductInput[] = [];
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return out;
  const idsJson = JSON.stringify(ids);

  const rows = await db.execute<MetaRow>(sql`
    WITH bounds AS (SELECT max(day)::date AS last_day FROM catalog_set_daily),
    t AS (
      SELECT c.product_id, c.group_id, c.name, s.name AS set_name, s.language,
             s.published_on::date AS rel
        FROM catalog_products c JOIN catalog_sets s ON s.group_id = c.group_id
       WHERE c.product_id IN (
         SELECT jsonb_array_elements_text(${idsJson}::jsonb)::bigint)
    ), ages AS (
      SELECT a::int AS age, o AS ord
        FROM jsonb_array_elements_text(${JSON.stringify(AGES)}::jsonb)
             WITH ORDINALITY AS e(a, o)
    )
    SELECT t.product_id::text AS product_id, t.group_id::text AS group_id,
           t.name, t.set_name, t.language, to_char(t.rel, 'YYYY-MM-DD') AS rel,
           jsonb_agg(
             CASE WHEN t.rel IS NOT NULL
                   AND t.rel + a.age <= (SELECT last_day FROM bounds) THEN
               (SELECT p.market_cents FROM catalog_prices p
                 WHERE p.product_id = t.product_id AND p.market_cents > 0
                   AND p.day <= (t.rel + a.age)
                   AND p.day > (t.rel + a.age - ${AGE_TOLERANCE_DAYS + 1}::int)
                 ORDER BY p.day DESC LIMIT 1)
             END
             ORDER BY a.ord
           ) AS prices
      FROM t CROSS JOIN ages a
     GROUP BY t.product_id, t.group_id, t.name, t.set_name, t.language, t.rel
  `);

  const latestRows = await db.execute<LatestRow>(sql`
    SELECT DISTINCT ON (p.product_id) p.product_id::text AS product_id,
           to_char(p.day, 'YYYY-MM-DD') AS day, p.market_cents
      FROM catalog_prices p
     WHERE p.product_id IN (
       SELECT jsonb_array_elements_text(${idsJson}::jsonb)::bigint)
       AND p.market_cents > 0
     ORDER BY p.product_id, p.day DESC
  `);
  const latestBy = new Map(latestRows.map((r) => [r.product_id, r]));

  const dayRow = await db.execute<{ day: string | null }>(sql`
    SELECT to_char(max(day), 'YYYY-MM-DD') AS day FROM catalog_set_daily
  `);
  const newest = dayRow[0]?.day ?? null;

  // A date many sets share is a bookkeeping stamp, not a real release.
  const dates = await db.execute<{ d: string | null }>(sql`
    SELECT to_char(published_on, 'YYYY-MM-DD') AS d FROM catalog_sets
  `);
  const bulk = bulkReleaseDates(dates.map((r) => r.d));

  for (const r of rows) {
    const latestRow = latestBy.get(r.product_id);
    const fresh =
      latestRow && newest
        ? (Date.parse(newest) - Date.parse(latestRow.day)) / 86_400_000 <=
          STALE_AFTER_DAYS
        : false;
    const releasedOn = r.rel && !bulk.has(r.rel) ? r.rel : null;
    const input: LifecycleInput = {
      groupId: Number(r.group_id),
      language: r.language === "ja" ? "ja" : "en",
      kind: sealedType(r.name),
      releasedOn,
      latest:
        fresh && latestRow
          ? { day: latestRow.day, cents: Number(latestRow.market_cents) }
          : null,
      prices: r.prices.map((p) => {
        const n = p == null ? NaN : Number(p);
        return Number.isFinite(n) ? n : null;
      }),
    };
    out.push({
      productId: Number(r.product_id),
      name: r.name,
      setName: r.set_name,
      input,
    });
  }
  return out;
}

export async function getLifecycles(
  productIds: ReadonlyArray<number>,
): Promise<Map<number, ProductLifecycle>> {
  const out = new Map<number, ProductLifecycle>();
  const [inputs, cohort] = await Promise.all([
    loadLifecycleInputs(productIds),
    getAgedProducts(),
  ]);
  for (const p of inputs) {
    out.set(p.productId, {
      ...buildLifecycle(p.input, cohort),
      productId: p.productId,
      name: p.name,
      setName: p.setName,
      releasedOn: p.input.releasedOn,
    });
  }
  return out;
}

export type StockTimingRow = {
  itemId: string;
  name: string;
  held: number;
  /** Inventory cost in the display currency (minor units). */
  cost: number;
  /** Null when the item isn't linked to a catalogue product. */
  lifecycle: ProductLifecycle | null;
};

export type StockTiming = {
  currency: CurrencyCode;
  /** Held items, biggest inventory cost first. */
  rows: StockTimingRow[];
  cost: CostByPhase;
  /** Held items that aren't linked to the catalogue yet. */
  unlinked: number;
};

/** Everything you hold, placed on the age and comparison picture. */
export async function getStockTiming(
  displayCurrency: CurrencyCode,
): Promise<StockTiming> {
  const { items, converted } = await getDashboardData(displayCurrency);

  const held = items
    .map((it, i) => ({ it, conv: converted[i] }))
    .filter(({ it }) => it.valuation.quantity > 0);

  const linkedIds = held
    .map(({ it }) => it.item.catalogProductId)
    .filter((id): id is number => id != null);
  const lifecycles = await getLifecycles(linkedIds);

  const rows: StockTimingRow[] = held
    .map(({ it, conv }) => ({
      itemId: it.item.id,
      name: it.item.name,
      held: it.valuation.quantity,
      cost: conv.inventoryCost,
      lifecycle:
        it.item.catalogProductId != null
          ? (lifecycles.get(Number(it.item.catalogProductId)) ?? null)
          : null,
    }))
    .sort((a, b) => b.cost - a.cost);

  return {
    currency: displayCurrency,
    rows,
    cost: costByPhase(
      rows.map((r) => ({ cost: r.cost, phase: r.lifecycle?.phase ?? null })),
    ),
    unlinked: rows.filter((r) => r.lifecycle == null).length,
  };
}
