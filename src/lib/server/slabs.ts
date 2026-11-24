import { asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, marketPrices, transactions, type Transaction } from "@/db/schema";
import { replayForAnalytics } from "@/lib/calc/analytics";
import { utcDay } from "@/lib/calc/pg_day";
import { isSlabName, parseGrade, type Grade } from "@/lib/calc/slab";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import { getCostMethod } from "./settings";

export type SlabItem = {
  itemId: string;
  name: string;
  imageUrl: string | null;
  grade: Grade | null;
  qty: number;
  /** Display currency, for the held units' cost; null if no exchange rate. */
  cost: number | null;
  /** Per unit, display currency. */
  slabEach: number | null;
  slabPriceAt: Date | null;
  /** The matched card's raw price per unit, display currency; null if none. */
  rawEach: number | null;
  rawDay: Date | null;
  card: {
    name: string;
    setName: string;
    groupId: number;
    language: string;
    number: string | null;
  } | null;
  /** The person marked the automatic match wrong. */
  rejected: boolean;
};

type Row = {
  id: string;
  card_name: string | null;
  card_number: string | null;
  group_id: string | number | null;
  set_name: string | null;
  language: string | null;
  raw_cents: string | number | null;
  raw_day: Date | string | null;
  card_id: string | number | null;
  skipped: boolean;
};

/**
 * Every graded slab you hold, with the card it was matched to and that card's
 * raw price. Raw prices are TCGplayer's market price for the card's best
 * printing, in US dollars, converted at today's rate like everything held now.
 */
export async function getSlabs(displayCurrency: CurrencyCode): Promise<SlabItem[]> {
  const [allItems, allTxs, prices, method, extra] = await Promise.all([
    db.select().from(items).orderBy(asc(items.name)),
    db.select().from(transactions),
    db
      .select({
        itemId: marketPrices.itemId,
        priceCents: marketPrices.priceCents,
        fetchedAt: marketPrices.fetchedAt,
      })
      .from(marketPrices)
      .orderBy(asc(marketPrices.fetchedAt)),
    getCostMethod(),
    db.execute<Row>(sql`
      SELECT i.id::text AS id, i.raw_card_product_id AS card_id, i.raw_card_skipped AS skipped,
             p.name AS card_name, p.card_number, p.group_id, s.name AS set_name, s.language,
             rp.market_cents AS raw_cents, rp.day AS raw_day
        FROM items i
        LEFT JOIN catalog_products p ON p.product_id = i.raw_card_product_id
        LEFT JOIN catalog_sets s ON s.group_id = p.group_id
        LEFT JOIN LATERAL (
              SELECT market_cents, day FROM catalog_prices
               WHERE product_id = p.product_id AND market_cents IS NOT NULL
               ORDER BY day DESC LIMIT 1) rp ON true
    `),
  ]);
  const extraById = new Map(Array.from(extra).map((r) => [r.id, r]));

  const txsByItem = new Map<string, Transaction[]>();
  for (const t of allTxs) {
    const l = txsByItem.get(t.itemId) ?? [];
    l.push(t);
    txsByItem.set(t.itemId, l);
  }
  const lastPrice = new Map<string, { cents: number; at: Date }>();
  for (const p of prices) lastPrice.set(p.itemId, { cents: Number(p.priceCents), at: p.fetchedAt });

  const rates = new Map<string, number>();
  const need = new Set<string>(["USD"]);
  for (const t of allTxs) need.add(t.currency);
  await Promise.all(
    [...need]
      .filter((c) => c !== displayCurrency)
      .map(async (c) => {
        try {
          rates.set(c, (await getRate(c as CurrencyCode, displayCurrency)).rate);
        } catch {
          // Left blank rather than guessed.
        }
      }),
  );
  const toShown = (minor: number, from: string): number | null => {
    if (from === displayCurrency) return minor;
    const r = rates.get(from);
    return r == null ? null : convertMinor(minor, from, displayCurrency, r);
  };

  const out: SlabItem[] = [];
  for (const it of allItems) {
    if (!isSlabName(it.name, it.tags)) continue;
    const txs = txsByItem.get(it.id) ?? [];
    if (txs.length === 0) continue;
    const { remaining } = replayForAnalytics(txs, method);
    const qty = remaining.reduce((n, e) => n + e.qty, 0);
    if (qty <= 0) continue;
    const currency = txs[0].currency;
    const price = lastPrice.get(it.id);
    const e = extraById.get(it.id);
    const rawUsd = e?.raw_cents == null ? null : Number(e.raw_cents);
    out.push({
      itemId: it.id,
      name: it.name,
      imageUrl: it.imageUrl,
      grade: parseGrade(it.name),
      qty,
      cost: toShown(
        remaining.reduce((n, x) => n + x.cost, 0),
        currency,
      ),
      slabEach: price ? toShown(price.cents, currency) : null,
      slabPriceAt: price ? price.at : null,
      rawEach: rawUsd == null ? null : toShown(rawUsd, "USD"),
      rawDay: e?.raw_day ? utcDay(e.raw_day) : null,
      card: e?.card_name
        ? {
            name: e.card_name,
            setName: e.set_name ?? "",
            groupId: Number(e.group_id),
            language: e.language ?? "en",
            number: e.card_number,
          }
        : null,
      rejected: !!e?.skipped,
    });
  }
  return out;
}
