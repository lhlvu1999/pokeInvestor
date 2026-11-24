import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { items, marketPrices, transactions, type Transaction } from "@/db/schema";
import {
  activeYears,
  flowGap,
  heldOn,
  isStale,
  priceOnOrBefore,
  yearFlow,
  type StockPrice,
} from "@/lib/calc/stock_on";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import { getCostMethod } from "./settings";

/**
 * Stock on any day, and how each year's stock moved. Money is converted to the
 * display currency at today's rate, like the rest of Analytics.
 */

async function load(displayCurrency: CurrencyCode) {
  const [allItems, allTxs, prices, method] = await Promise.all([
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
  ]);
  const txsByItem = new Map<string, Transaction[]>();
  for (const t of allTxs) {
    const l = txsByItem.get(t.itemId) ?? [];
    l.push(t);
    txsByItem.set(t.itemId, l);
  }
  const pricesByItem = new Map<string, StockPrice[]>();
  for (const p of prices) {
    const l = pricesByItem.get(p.itemId) ?? [];
    l.push({ priceCents: Number(p.priceCents), fetchedAt: p.fetchedAt });
    pricesByItem.set(p.itemId, l);
  }
  const currencies = new Set<string>();
  for (const t of allTxs) if (t.currency !== displayCurrency) currencies.add(t.currency);
  const rates = new Map<string, number>();
  await Promise.all(
    [...currencies].map(async (c) => {
      try {
        rates.set(c, (await getRate(c as CurrencyCode, displayCurrency)).rate);
      } catch {
        // Left out of the totals; the report says how many lines that touches.
      }
    }),
  );
  const toShown = (minor: number, from: string): number | null => {
    if (from === displayCurrency) return minor;
    const r = rates.get(from);
    return r == null ? null : convertMinor(minor, from, displayCurrency, r);
  };
  return { allItems, allTxs, txsByItem, pricesByItem, method, toShown };
}

export type YearStock = {
  year: number;
  complete: boolean;
  closedOn: Date;
  open: number;
  bought: number;
  out: number;
  close: number;
  /** Closing figures should add up; non-zero means rounding or a data oddity. */
  gap: number;
  closeUnits: number;
  /** Market value of the held items that had a price on that day. */
  value: number;
  heldItems: number;
  pricedItems: number;
  /** Cost of held items with no price on that day (not in `value`). */
  unpricedCost: number;
  staleItems: number;
  /** Items left out of every figure because no exchange rate was found. */
  unconverted: number;
};

export type StockReport = {
  years: YearStock[];
  /** Received-later buys: paid for, not yet stock. Today's figure. */
  inTransit: { units: number; cost: number };
  firstPriceDay: string | null;
};

export async function getStockReport(
  displayCurrency: CurrencyCode,
  now = new Date(),
): Promise<StockReport> {
  const { allItems, allTxs, txsByItem, pricesByItem, method, toShown } = await load(displayCurrency);
  const years = activeYears(allTxs, now);
  const rows: YearStock[] = years.map((year) => ({
    year,
    complete: false,
    closedOn: now,
    open: 0,
    bought: 0,
    out: 0,
    close: 0,
    gap: 0,
    closeUnits: 0,
    value: 0,
    heldItems: 0,
    pricedItems: 0,
    unpricedCost: 0,
    staleItems: 0,
    unconverted: 0,
  }));
  for (const it of allItems) {
    const txs = txsByItem.get(it.id) ?? [];
    if (txs.length === 0) continue;
    const currency = txs[0].currency;
    const prices = pricesByItem.get(it.id) ?? [];
    rows.forEach((row) => {
      const f = yearFlow(txs, row.year, method, now);
      row.complete = f.complete;
      row.closedOn = f.closedOn;
      const parts = [f.open.cost, f.bought, f.out, f.close.cost, flowGap(f)].map((v) =>
        toShown(v, currency),
      );
      if (parts.some((p) => p == null)) {
        if (f.open.cost + f.bought + f.out + f.close.cost > 0) row.unconverted += 1;
        return;
      }
      const [open, bought, out, close, gap] = parts as number[];
      row.open += open;
      row.bought += bought;
      row.out += out;
      row.close += close;
      row.gap += gap;
      if (f.close.qty > 0) {
        row.closeUnits += f.close.qty;
        row.heldItems += 1;
        const p = priceOnOrBefore(prices, f.closedOn);
        const v = p ? toShown(f.close.qty * p.priceCents, currency) : null;
        if (p && v != null) {
          row.value += v;
          row.pricedItems += 1;
          if (isStale(p, f.closedOn)) row.staleItems += 1;
        } else {
          row.unpricedCost += close;
        }
      }
    });
  }
  let units = 0;
  let cost = 0;
  for (const t of allTxs) {
    if (t.type !== "buy" || t.status !== "pending") continue;
    const shown = toShown(t.finalValueCents, t.currency);
    if (shown == null) continue;
    units += t.quantity;
    cost += shown;
  }
  const first = [...pricesByItem.values()]
    .map((l) => l[0]?.fetchedAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    years: rows,
    inTransit: { units, cost },
    firstPriceDay: first ? first.toISOString().slice(0, 10) : null,
  };
}

export type StockLine = {
  itemId: string;
  name: string;
  currency: string;
  qty: number;
  /** Native currency. */
  cost: number;
  priceCents: number | null;
  priceAt: Date | null;
  stale: boolean;
  /** Display currency; null when no exchange rate was found. */
  costShown: number | null;
  valueShown: number | null;
};

/** Every item held at the end of `asOf`, with cost and value. */
export async function getStockOn(
  asOf: Date,
  displayCurrency: CurrencyCode,
): Promise<StockLine[]> {
  const { allItems, txsByItem, pricesByItem, method, toShown } = await load(displayCurrency);
  const lines: StockLine[] = [];
  for (const it of allItems) {
    const txs = txsByItem.get(it.id) ?? [];
    if (txs.length === 0) continue;
    const held = heldOn(txs, asOf, method);
    if (held.qty <= 0) continue;
    const currency = txs[0].currency;
    const p = priceOnOrBefore(pricesByItem.get(it.id) ?? [], asOf);
    lines.push({
      itemId: it.id,
      name: it.name,
      currency,
      qty: held.qty,
      cost: held.cost,
      priceCents: p ? p.priceCents : null,
      priceAt: p ? p.fetchedAt : null,
      stale: p ? isStale(p, asOf) : false,
      costShown: toShown(held.cost, currency),
      valueShown: p ? toShown(held.qty * p.priceCents, currency) : null,
    });
  }
  return lines.sort(
    (a, b) => (b.valueShown ?? b.costShown ?? 0) - (a.valueShown ?? a.costShown ?? 0),
  );
}
