/**
 * Loaders for the Sets pages: the list of every set with its latest totals,
 * and which of your items are linked to a set's sealed products. Pure reads
 * (no "use server").
 */

import { inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import { utcDay } from "@/lib/calc/pg_day";
import { bulkReleaseDates, comparableChange } from "@/lib/calc/set_list";

export type SetListRow = {
  groupId: number;
  name: string;
  language: "en" | "ja";
  abbreviation: string | null;
  /** YYYY-MM-DD, if known. */
  publishedOn: string | null;
  sealedCount: number;
  cardCount: number;
  pricedCount: number;
  totalCents: number;
  top10Cents: number;
  top20Cents: number;
  /** Change in set value over about a month, once there's history. */
  changePct: number | null;
  /** How many of your items are linked to this set's sealed products. */
  yourItems: number;
  /** Day of the figures, if the set has any. */
  asOf: string | null;
};

type Row = {
  group_id: string | number;
  name: string;
  language: string;
  abbreviation: string | null;
  published_on: unknown;
  sealed_count: string | number;
  your_items: string | number;
  day: unknown;
  card_count: number | null;
  priced_count: number | null;
  total_cents: string | number | null;
  top10_cents: string | number | null;
  top20_cents: string | number | null;
  prior_total: string | number | null;
  prior_priced: number | null;
};

const day10 = (v: unknown): string | null => {
  const d = utcDay(v);
  return d ? d.toISOString().slice(0, 10) : null;
};

/** Every set with its newest totals; sets with no priced cards have zeros. */
export async function getSetsList(): Promise<{
  rows: SetListRow[];
  asOf: string | null;
}> {
  const result = await db.execute<Row>(sql`
    SELECT s.group_id, s.name, s.language, s.abbreviation, s.published_on,
           (SELECT count(*) FROM catalog_products p
             WHERE p.group_id = s.group_id AND p.kind = 'sealed') AS sealed_count,
           (SELECT count(*) FROM items i
              JOIN catalog_products p ON p.product_id = i.catalog_product_id
             WHERE p.group_id = s.group_id) AS your_items,
           d.day, d.card_count, d.priced_count,
           d.total_cents, d.top10_cents, d.top20_cents,
           (SELECT o.total_cents FROM catalog_set_daily o
             WHERE o.group_id = s.group_id
               AND o.day <= d.day - interval '30 days'
             ORDER BY o.day DESC LIMIT 1) AS prior_total,
           (SELECT o.priced_count FROM catalog_set_daily o
             WHERE o.group_id = s.group_id
               AND o.day <= d.day - interval '30 days'
             ORDER BY o.day DESC LIMIT 1) AS prior_priced
      FROM catalog_sets s
      LEFT JOIN LATERAL (
        SELECT * FROM catalog_set_daily
         WHERE group_id = s.group_id ORDER BY day DESC LIMIT 1
      ) d ON true
  `);
  let newest: string | null = null;
  const rows = Array.from(result).map((r): SetListRow => {
    const asOf = day10(r.day);
    if (asOf && (!newest || asOf > newest)) newest = asOf;
    const total = r.total_cents == null ? 0 : Number(r.total_cents);
    const prior = r.prior_total == null ? null : Number(r.prior_total);
    return {
      groupId: Number(r.group_id),
      name: r.name,
      language: r.language === "ja" ? "ja" : "en",
      abbreviation: r.abbreviation,
      publishedOn: day10(r.published_on),
      sealedCount: Number(r.sealed_count),
      cardCount: r.card_count ?? 0,
      pricedCount: r.priced_count ?? 0,
      totalCents: total,
      top10Cents: r.top10_cents == null ? 0 : Number(r.top10_cents),
      top20Cents: r.top20_cents == null ? 0 : Number(r.top20_cents),
      changePct: comparableChange({
        totalCents: total,
        pricedCount: r.priced_count ?? 0,
        priorTotalCents: prior,
        priorPricedCount: r.prior_priced,
      }),
      yourItems: Number(r.your_items),
      asOf,
    };
  });
  // A date carried by dozens of sets is a bulk stamp, not a release day.
  const bulk = bulkReleaseDates(rows.map((r) => r.publishedOn));
  for (const r of rows) {
    if (r.publishedOn && bulk.has(r.publishedOn)) r.publishedOn = null;
  }
  return { rows, asOf: newest };
}

export type LinkedItem = { id: string; name: string; productId: number };

/** Your items linked to any of these catalogue products. */
export async function getLinkedItems(
  productIds: ReadonlyArray<number>,
): Promise<Map<number, LinkedItem[]>> {
  const out = new Map<number, LinkedItem[]>();
  if (productIds.length === 0) return out;
  const rows = await db
    .select({
      id: items.id,
      name: items.name,
      productId: items.catalogProductId,
    })
    .from(items)
    .where(inArray(items.catalogProductId, [...productIds]));
  for (const r of rows) {
    if (r.productId == null) continue;
    const list = out.get(r.productId) ?? [];
    list.push({ id: r.id, name: r.name, productId: r.productId });
    out.set(r.productId, list);
  }
  return out;
}

export type SetHistoryPoint = {
  day: string;
  totalCents: number;
  top20Cents: number;
  top10Cents: number;
  pricedCount: number;
};

const dayText = (v: unknown): string | null => {
  const d = utcDay(v);
  return d ? d.toISOString().slice(0, 10) : null;
};

/** A set's daily value history, oldest first. */
export async function getSetHistory(
  groupId: number,
): Promise<SetHistoryPoint[]> {
  const rows = await db.execute<{
    day: unknown;
    total_cents: string | number;
    top20_cents: string | number;
    top10_cents: string | number;
    priced_count: number;
  }>(sql`
    SELECT day, total_cents, top20_cents, top10_cents, priced_count
      FROM catalog_set_daily WHERE group_id = ${groupId} ORDER BY day
  `);
  return Array.from(rows).flatMap((r) => {
    const day = dayText(r.day);
    return day
      ? [
          {
            day,
            totalCents: Number(r.total_cents),
            top20Cents: Number(r.top20_cents),
            top10Cents: Number(r.top10_cents),
            pricedCount: r.priced_count,
          },
        ]
      : [];
  });
}

/** Daily market prices per sealed product, oldest first. */
export async function getSealedHistory(
  productIds: ReadonlyArray<number>,
): Promise<Map<number, { day: string; cents: number }[]>> {
  const out = new Map<number, { day: string; cents: number }[]>();
  if (productIds.length === 0) return out;
  const rows = await db.execute<{
    product_id: string | number;
    day: unknown;
    market_cents: string | number;
  }>(sql`
    SELECT product_id, day, market_cents
      FROM catalog_prices
     WHERE product_id IN (${sql.join(
       productIds.map((id) => sql`${id}`),
       sql`, `,
     )})
       AND market_cents IS NOT NULL
     ORDER BY product_id, day
  `);
  for (const r of rows) {
    const day = dayText(r.day);
    if (!day) continue;
    const id = Number(r.product_id);
    const list = out.get(id) ?? [];
    list.push({ day, cents: Number(r.market_cents) });
    out.set(id, list);
  }
  return out;
}
