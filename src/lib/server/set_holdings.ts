/**
 * What you hold in a catalogue set, and which set an item belongs to. Pure reads.
 *
 * Only the items in the set are loaded and valued, so this is cheap enough to run
 * when an item page or the item drawer opens.
 */

import { desc, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, marketPrices, transactions } from "@/db/schema";
import { computeHoldings, valueHoldings } from "@/lib/calc/holdings";
import { summarizeSetHoldings, type SetHoldingsSummary, type SetItemInput } from "@/lib/calc/set_holdings";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import { getCostMethod } from "./settings";

export type ItemSetLink = { groupId: number; name: string; language: "en" | "ja" };

/** The set an item belongs to: its linked sealed product's, or its matched card's. */
export async function getItemSetLink(item: {
  catalogProductId: number | null;
  rawCardProductId: number | null;
}): Promise<ItemSetLink | null> {
  const productId = item.catalogProductId ?? item.rawCardProductId;
  if (productId == null) return null;
  const rows = await db.execute<{ group_id: string | number; name: string; language: string }>(sql`
    SELECT s.group_id, s.name, s.language
      FROM catalog_products p JOIN catalog_sets s ON s.group_id = p.group_id
     WHERE p.product_id = ${productId}
  `);
  const r = Array.from(rows)[0];
  return r
    ? { groupId: Number(r.group_id), name: r.name, language: r.language === "ja" ? "ja" : "en" }
    : null;
}

export type SetHoldings = SetHoldingsSummary & {
  groupId: number;
  currency: string;
  /** Items in the set that carry no price conversion because no exchange rate was found. */
  skipped: number;
};

export async function getSetHoldings(
  groupId: number,
  displayCurrency: string,
): Promise<SetHoldings> {
  const memberRows = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT i.id::text AS id
      FROM items i
      JOIN catalog_products p
        ON p.product_id = i.catalog_product_id OR p.product_id = i.raw_card_product_id
     WHERE p.group_id = ${groupId}
  `);
  const ids = Array.from(memberRows).map((r) => r.id);
  const empty = summarizeSetHoldings([]);
  if (ids.length === 0) return { ...empty, groupId, currency: displayCurrency, skipped: 0 };

  const [itemRows, txRows, priceRows, method] = await Promise.all([
    db.select().from(items).where(inArray(items.id, ids)),
    db.select().from(transactions).where(inArray(transactions.itemId, ids)),
    db.select().from(marketPrices).where(inArray(marketPrices.itemId, ids)).orderBy(desc(marketPrices.fetchedAt)),
    getCostMethod(),
  ]);
  const latest = new Map<string, (typeof priceRows)[number]>();
  for (const p of priceRows) if (!latest.has(p.itemId)) latest.set(p.itemId, p);
  const txByItem = new Map<string, typeof txRows>();
  for (const t of txRows) {
    const list = txByItem.get(t.itemId) ?? [];
    list.push(t);
    txByItem.set(t.itemId, list);
  }

  const rates = new Map<string, number | null>();
  async function rateFor(from: string): Promise<number | null> {
    if (from === displayCurrency) return 1;
    if (!rates.has(from)) {
      try {
        rates.set(from, (await getRate(from as CurrencyCode, displayCurrency as CurrencyCode)).rate);
      } catch {
        rates.set(from, null);
      }
    }
    return rates.get(from) ?? null;
  }

  const rows: SetItemInput[] = [];
  let skipped = 0;
  for (const item of itemRows) {
    const price = latest.get(item.id) ?? null;
    let v;
    try {
      v = valueHoldings(computeHoldings(txByItem.get(item.id) ?? [], method), price?.priceCents ?? null);
    } catch {
      skipped += 1;
      continue;
    }
    const native = v.currency || price?.currency || displayCurrency;
    const rate = await rateFor(native);
    if (rate == null) {
      skipped += 1;
      continue;
    }
    const conv = (m: number) => (native === displayCurrency ? m : convertMinor(m, native, displayCurrency, rate));
    rows.push({
      id: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      units: v.quantity,
      cost: conv(v.inventoryCostCents),
      value: price ? conv(v.marketValueCents) : 0,
      hasPrice: price != null,
    });
  }
  return { ...summarizeSetHoldings(rows), groupId, currency: displayCurrency, skipped };
}
