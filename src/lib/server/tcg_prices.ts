/**
 * Price linked items from the catalogue (TCGplayer's market price), which follows
 * recent sales, instead of from eBay asking prices. See `calc/tcg_price.ts` for the
 * rules. A plain module (not "use server"): it is called by the refresh flows.
 *
 * The catalogue price is in US cents; the item's price is stored in the currency of
 * its transactions, so it is converted at today's rate, the way the PriceCharting
 * refresh does it.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { marketPrices } from "@/db/schema";
import { needsTcgWrite, usableCatalogUsdCents } from "@/lib/calc/tcg_price";
import { convertMinor, isSupportedCurrency, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";

export type TcgOutcome =
  | { status: "saved"; priceCents: number; currency: string; usdCents: number }
  | { status: "uptodate" }
  | { status: "error"; message: string };

type Row = {
  id: string;
  day: Date | string | null;
  market_cents: string | number | null;
  currency: string | null;
  newest_source: string | null;
  newest_at: Date | string | null;
};

async function loadRows(itemIds?: string[]): Promise<Row[]> {
  if (itemIds && itemIds.length === 0) return [];
  const only = itemIds
    ? sql`AND i.id IN (${sql.join(
        itemIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const rows = await db.execute<Row>(sql`
    SELECT i.id::text AS id,
      (SELECT cp.day FROM catalog_prices cp
        WHERE cp.product_id = i.catalog_product_id AND cp.market_cents IS NOT NULL
        ORDER BY cp.day DESC LIMIT 1) AS day,
      (SELECT cp.market_cents FROM catalog_prices cp
        WHERE cp.product_id = i.catalog_product_id AND cp.market_cents IS NOT NULL
        ORDER BY cp.day DESC LIMIT 1) AS market_cents,
      (SELECT t.currency FROM transactions t
        WHERE t.item_id = i.id ORDER BY t.occurred_at ASC LIMIT 1) AS currency,
      (SELECT m.source::text FROM market_prices m
        WHERE m.item_id = i.id ORDER BY m.fetched_at DESC LIMIT 1) AS newest_source,
      (SELECT m.fetched_at FROM market_prices m
        WHERE m.item_id = i.id ORDER BY m.fetched_at DESC LIMIT 1) AS newest_at
    FROM items i
    WHERE i.catalog_product_id IS NOT NULL ${only}
  `);
  return Array.from(rows);
}

function usdCentsOf(r: Row, now: Date): number | null {
  return usableCatalogUsdCents({
    marketCents: r.market_cents == null ? null : Number(r.market_cents),
    day: r.day == null ? null : new Date(r.day),
    now,
    itemCurrency: r.currency,
  });
}

/** Items the catalogue can price right now (so eBay is not needed for them). */
export async function tcgCoveredIds(itemIds?: string[]): Promise<Set<string>> {
  const now = new Date();
  const out = new Set<string>();
  for (const r of await loadRows(itemIds)) {
    if (usdCentsOf(r, now) != null) out.add(r.id);
  }
  return out;
}

/**
 * Write a TCGplayer price row for every given item (all linked items when none are
 * given) that the catalogue can price and that has not just had one. Returns an
 * outcome per item the catalogue covers; other items are absent from the map.
 * With `onlyIfUnpriced`, items that already have any price are left alone.
 */
export async function applyCatalogPrices(
  itemIds?: string[],
  opts: { onlyIfUnpriced?: boolean } = {},
): Promise<Map<string, TcgOutcome>> {
  const now = new Date();
  const outcomes = new Map<string, TcgOutcome>();
  const rates = new Map<string, number | null>();
  const toWrite: { itemId: string; priceCents: number; currency: CurrencyCode; usd: number }[] = [];

  for (const r of await loadRows(itemIds)) {
    const usd = usdCentsOf(r, now);
    if (usd == null) continue;
    const newest = r.newest_source
      ? { source: r.newest_source, fetchedAt: new Date(r.newest_at as Date | string) }
      : null;
    if (opts.onlyIfUnpriced && newest) continue;
    if (!needsTcgWrite(newest, now)) {
      outcomes.set(r.id, { status: "uptodate" });
      continue;
    }
    const currency = (r.currency ?? "").toUpperCase();
    if (!isSupportedCurrency(currency)) {
      outcomes.set(r.id, { status: "error", message: `Unsupported currency ${currency}` });
      continue;
    }
    let price = usd;
    if (currency !== "USD") {
      if (!rates.has(currency)) {
        try {
          rates.set(currency, (await getRate("USD", currency)).rate);
        } catch {
          rates.set(currency, null);
        }
      }
      const rate = rates.get(currency);
      if (rate == null) {
        outcomes.set(r.id, { status: "error", message: "Exchange rate unavailable" });
        continue;
      }
      price = convertMinor(usd, "USD", currency, rate);
    }
    if (!Number.isInteger(price) || price <= 0) {
      outcomes.set(r.id, { status: "error", message: "Converted price is not usable" });
      continue;
    }
    toWrite.push({ itemId: r.id, priceCents: price, currency, usd });
  }

  if (toWrite.length > 0) {
    await db.insert(marketPrices).values(
      toWrite.map((w) => ({
        itemId: w.itemId,
        priceCents: w.priceCents,
        currency: w.currency,
        source: "tcgplayer" as const,
      })),
    );
    for (const w of toWrite) {
      outcomes.set(w.itemId, {
        status: "saved",
        priceCents: w.priceCents,
        currency: w.currency,
        usdCents: w.usd,
      });
    }
  }
  return outcomes;
}
