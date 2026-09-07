/**
 * Analytics derived from `market_prices` — the half of the portfolio the
 * existing analytics page can't see.
 *
 * `analytics.ts` is entirely realized/sell-based: it can tell you what
 * you made on things you already sold. This module covers the other side
 * — what your *open* positions are currently worth, and which way they
 * have moved since the last snapshot.
 *
 * Pure read (no "use server") so it isn't exposed as a client-callable
 * action, matching sell_scorecard.ts / creator_scores.ts.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { marketPrices } from "@/db/schema";
import {
  changeOverDays,
  latestPrice,
  seriesBounds,
  type PriceChange,
  type PricePoint,
} from "@/lib/calc/price_history";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import { getDashboardData } from "./portfolio";

/** Lookback for the "movers" ranking. */
export const MOVER_WINDOW_DAYS = 30;

export type PricedPosition = {
  itemId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  /** All display-currency, so they sum across a mixed-currency book. */
  costBasisDisplay: number;
  marketValueDisplay: number;
  unrealizedDisplay: number;
  /** marketValue / costBasis - 1. Null when cost basis is zero. */
  unrealizedPct: number | null;
  /** Native-currency price movement. Null until 2+ snapshots exist. */
  change: PriceChange | null;
  snapshotCount: number;
  lastPricedAt: Date | null;
  nativeCurrency: string;
};

export type PriceAnalytics = {
  /** Held items that have at least one market price, by value desc. */
  positions: PricedPosition[];
  /** Held items with no price at all — the coverage gap. */
  unpricedCount: number;
  unpricedNames: string[];
  /** Inventory cost tied up in those unpriced items, so the gap can be
   * expressed in money rather than just a count. */
  unpricedCostBasis: number;
  totalCostBasis: number;
  totalMarketValue: number;
  totalUnrealized: number;
  /** Positions with a computable change, best/worst first. */
  topGainers: PricedPosition[];
  topLosers: PricedPosition[];
  /** How many positions have enough history to show a trend at all. */
  withHistoryCount: number;
};

const TOP_N = 8;

export async function getPriceAnalytics(
  displayCurrency: CurrencyCode,
): Promise<PriceAnalytics> {
  const { items, converted } = await getDashboardData(displayCurrency);

  // Held positions only — an item you fully sold has no unrealized P&L.
  const held = items
    .map((iv, i) => ({ iv, conv: converted[i] }))
    .filter(({ iv }) => iv.valuation.quantity > 0);

  if (held.length === 0) {
    return {
      positions: [],
      unpricedCount: 0,
      unpricedNames: [],
      unpricedCostBasis: 0,
      totalCostBasis: 0,
      totalMarketValue: 0,
      totalUnrealized: 0,
      topGainers: [],
      topLosers: [],
      withHistoryCount: 0,
    };
  }

  // One query for the whole price table, grouped in JS. The table is
  // small (one row per refresh per item) and this avoids N+1.
  const allPrices = await db
    .select({
      itemId: marketPrices.itemId,
      priceCents: marketPrices.priceCents,
      currency: marketPrices.currency,
      fetchedAt: marketPrices.fetchedAt,
    })
    .from(marketPrices);

  const historyByItem = new Map<string, PricePoint[]>();
  const currencyByItem = new Map<string, string>();
  for (const p of allPrices) {
    const list = historyByItem.get(p.itemId) ?? [];
    list.push({ fetchedAt: p.fetchedAt, priceCents: p.priceCents });
    historyByItem.set(p.itemId, list);
    if (!currencyByItem.has(p.itemId)) currencyByItem.set(p.itemId, p.currency);
  }

  // Resolve FX once per distinct source currency.
  const needed = new Set<string>();
  for (const { iv } of held) {
    const c = currencyByItem.get(iv.item.id);
    if (c && c !== displayCurrency) needed.add(c);
  }
  const rates = new Map<string, number>();
  await Promise.all(
    Array.from(needed).map(async (from) => {
      try {
        const { rate } = await getRate(from as CurrencyCode, displayCurrency);
        rates.set(from, rate);
      } catch {
        // Leave unset; positions in that currency fall back to unconverted
        // market value of 0 rather than a wrong number.
      }
    }),
  );

  const positions: PricedPosition[] = [];
  const unpricedNames: string[] = [];
  let unpricedCostBasis = 0;

  for (const { iv, conv } of held) {
    const history = historyByItem.get(iv.item.id) ?? [];
    const latest = latestPrice(history);
    if (!latest) {
      unpricedNames.push(iv.item.name);
      unpricedCostBasis += conv.inventoryCost;
      continue;
    }

    const nativeCurrency = currencyByItem.get(iv.item.id) ?? displayCurrency;
    const unitNative = latest.priceCents;
    const totalNative = unitNative * iv.valuation.quantity;

    let marketValueDisplay = totalNative;
    if (nativeCurrency !== displayCurrency) {
      const rate = rates.get(nativeCurrency);
      marketValueDisplay =
        rate == null
          ? 0
          : convertMinor(totalNative, nativeCurrency, displayCurrency, rate);
    }

    const costBasisDisplay = conv.inventoryCost;
    const unrealizedDisplay = marketValueDisplay - costBasisDisplay;

    positions.push({
      itemId: iv.item.id,
      name: iv.item.name,
      imageUrl: iv.item.imageUrl,
      quantity: iv.valuation.quantity,
      costBasisDisplay,
      marketValueDisplay,
      unrealizedDisplay,
      unrealizedPct:
        costBasisDisplay > 0 ? marketValueDisplay / costBasisDisplay - 1 : null,
      change: changeOverDays(history, MOVER_WINDOW_DAYS),
      snapshotCount: seriesBounds(history)?.count ?? 0,
      lastPricedAt: latest.fetchedAt,
      nativeCurrency,
    });
  }

  positions.sort((a, b) => b.marketValueDisplay - a.marketValueDisplay);

  const withChange = positions.filter((p) => p.change != null);
  const byChangeDesc = [...withChange].sort(
    (a, b) => b.change!.changePct - a.change!.changePct,
  );

  return {
    positions,
    unpricedCount: unpricedNames.length,
    unpricedNames,
    unpricedCostBasis,
    totalCostBasis: positions.reduce((s, p) => s + p.costBasisDisplay, 0),
    totalMarketValue: positions.reduce((s, p) => s + p.marketValueDisplay, 0),
    totalUnrealized: positions.reduce((s, p) => s + p.unrealizedDisplay, 0),
    topGainers: byChangeDesc
      .filter((p) => p.change!.changePct > 0)
      .slice(0, TOP_N),
    topLosers: byChangeDesc
      .filter((p) => p.change!.changePct < 0)
      .slice(-TOP_N)
      .reverse(),
    withHistoryCount: withChange.length,
  };
}

/** Full snapshot series for one item, ascending — powers the detail chart. */
export async function getItemPriceHistory(
  itemId: string,
): Promise<{ points: PricePoint[]; currency: string | null }> {
  const rows = await db
    .select({
      priceCents: marketPrices.priceCents,
      currency: marketPrices.currency,
      fetchedAt: marketPrices.fetchedAt,
    })
    .from(marketPrices)
    .where(eq(marketPrices.itemId, itemId))
    .orderBy(asc(marketPrices.fetchedAt));

  return {
    points: rows.map((r) => ({
      fetchedAt: r.fetchedAt,
      priceCents: r.priceCents,
    })),
    currency: rows[0]?.currency ?? null,
  };
}
