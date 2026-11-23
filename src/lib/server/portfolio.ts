import { db } from "@/db/client";
import { items as itemsTable, marketPrices, transactions } from "@/db/schema";
import {
  type ConvertedItemValues,
  summarizePortfolio,
  type PortfolioSummary,
} from "@/lib/calc/portfolio";
import { computeCashflowLines } from "@/lib/calc/cashflow_lines";
import type { WindowLine } from "@/lib/calc/cashflow_window";
import {
  computePortfolioSnapshots,
  weeklySnapshotDates,
} from "@/lib/calc/portfolio_value";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import { listItemsWithValuations, type ItemWithValuation } from "./items";
import { getCostMethod } from "./settings";

export type DashboardData = {
  items: ItemWithValuation[];
  /** Per-item values converted to display currency. Index-aligned with `items`. */
  converted: ConvertedItemValues[];
  summary: PortfolioSummary;
  displayCurrency: CurrencyCode;
  fxNotes: FxNote[];
};

export type FxNote = {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number;
  fetchedAt: Date;
  stale: boolean;
};

export type TagRollup = {
  tag: string;
  itemCount: number;
  itemsHeld: number;
  totalSpent: number;
  totalReceived: number;
  inventoryCost: number;
  marketValue: number;
  realized: number;
  unrealized: number;
};

/**
 * Loads all items with valuations and converts each to `displayCurrency` using
 * the cached/live FX rate. Skips items with no transactions and unknown
 * currencies. Returns FX notes so the UI can disclose what rates were used.
 */
export async function getDashboardData(
  displayCurrency: CurrencyCode,
): Promise<DashboardData> {
  const items = await listItemsWithValuations();

  // Collect distinct source currencies that need conversion.
  const fromCurrencies = new Set<string>();
  for (const i of items) {
    const c = i.valuation.currency;
    if (c && c !== displayCurrency) fromCurrencies.add(c);
  }

  const fxNotes: FxNote[] = [];
  const rateMap = new Map<string, number>(); // key = `${from}->${to}`
  // Resolve all FX rates in parallel — a 4-currency portfolio with a cold
  // cache used to take ~4× the latency of a single HTTP round-trip.
  const fxResults = await Promise.all(
    Array.from(fromCurrencies).map(async (from) => {
      try {
        const r = await getRate(from as CurrencyCode, displayCurrency);
        return { from, ok: true as const, ...r };
      } catch {
        return { from, ok: false as const };
      }
    }),
  );
  for (const r of fxResults) {
    if (!r.ok) continue;
    rateMap.set(`${r.from}->${displayCurrency}`, r.rate);
    fxNotes.push({
      from: r.from as CurrencyCode,
      to: displayCurrency,
      rate: r.rate,
      fetchedAt: r.fetchedAt,
      stale: r.stale,
    });
  }

  const converted: ConvertedItemValues[] = items.map(
    ({ valuation, latestPrice }) => {
      // Carried explicitly rather than inferred from `marketValue > 0`,
      // which cannot tell an unpriced item from a worthless one.
      const hasPrice = latestPrice != null;
      const c = valuation.currency || displayCurrency;
      if (c === displayCurrency) {
        return {
          inventoryCost: valuation.inventoryCostCents,
          marketValue: valuation.marketValueCents,
          realized: valuation.realizedProfitCents,
          unrealized: valuation.unrealizedProfitCents,
          quantity: valuation.quantity,
          totalSpent: valuation.totalBoughtCents,
          totalReceived: valuation.totalSoldCents,
          hasPrice,
        };
      }
      const rate = rateMap.get(`${c}->${displayCurrency}`);
      if (rate == null) {
        return {
          inventoryCost: 0,
          marketValue: 0,
          realized: 0,
          unrealized: 0,
          quantity: 0,
          totalSpent: 0,
          totalReceived: 0,
          // FX unavailable: the item is excluded from every total, so it
          // is not "priced" for coverage purposes either.
          hasPrice: false,
        };
      }
      const conv = (m: number) => convertMinor(m, c, displayCurrency, rate);
      return {
        inventoryCost: conv(valuation.inventoryCostCents),
        marketValue: conv(valuation.marketValueCents),
        realized: conv(valuation.realizedProfitCents),
        unrealized: conv(valuation.unrealizedProfitCents),
        quantity: valuation.quantity,
        totalSpent: conv(valuation.totalBoughtCents),
        totalReceived: conv(valuation.totalSoldCents),
        hasPrice,
      };
    },
  );

  return {
    items,
    converted,
    summary: summarizePortfolio(converted),
    displayCurrency,
    fxNotes,
  };
}

/**
 * Roll up each item's display-currency values across its tags. An item with
 * multiple tags contributes to every one of them (so totals across tags will
 * exceed the portfolio total when items overlap — that's intentional).
 *
 * Sorted by total spent, descending.
 */
export function rollupByTag(
  items: ItemWithValuation[],
  converted: ConvertedItemValues[],
): TagRollup[] {
  const buckets = new Map<string, TagRollup>();
  items.forEach(({ item, valuation }, i) => {
    const conv = converted[i];
    if (!item.tags || item.tags.length === 0) return;
    for (const tag of item.tags) {
      const cur =
        buckets.get(tag) ??
        ({
          tag,
          itemCount: 0,
          itemsHeld: 0,
          totalSpent: 0,
          totalReceived: 0,
          inventoryCost: 0,
          marketValue: 0,
          realized: 0,
          unrealized: 0,
        } satisfies TagRollup);
      cur.itemCount += 1;
      if (valuation.quantity > 0) cur.itemsHeld += 1;
      cur.totalSpent += conv.totalSpent;
      cur.totalReceived += conv.totalReceived;
      cur.inventoryCost += conv.inventoryCost;
      cur.marketValue += conv.marketValue;
      cur.realized += conv.realized;
      cur.unrealized += conv.unrealized;
      buckets.set(tag, cur);
    }
  });
  return Array.from(buckets.values()).sort(
    (a, b) => b.totalSpent - a.totalSpent,
  );
}

export type CashflowFilter = {
  /** When provided, only transactions of these items are included. */
  itemIdsFilter?: ReadonlySet<string>;
};

export type CashflowLines = {
  /** Per-(month, item) activity in display currency, oldest first. */
  lines: WindowLine[];
  /** First / last month with any activity; null when there is none. */
  bounds: { first: string; last: string } | null;
};

/**
 * Cashflow broken down per (month, item), converted to `displayCurrency`.
 * The dashboard's cashflow explorer derives every figure it shows — bars,
 * totals, top items — from these rows, so they always agree.
 *
 * Realized profit uses the same specific-lot + FIFO replay as
 * computeHoldings.
 */
export async function getCashflowLines(
  displayCurrency: CurrencyCode,
  filter: CashflowFilter = {},
): Promise<CashflowLines> {
  const [txs, itemRows] = await Promise.all([
    db.select().from(transactions),
    db.select({ id: itemsTable.id, name: itemsTable.name }).from(itemsTable),
  ]);
  if (txs.length === 0) return { lines: [], bounds: null };

  const byItem = new Map<string, typeof txs>();
  for (const t of txs) {
    if (filter.itemIdsFilter && !filter.itemIdsFilter.has(t.itemId)) continue;
    const list = byItem.get(t.itemId) ?? [];
    list.push(t);
    byItem.set(t.itemId, list);
  }
  const nameById = new Map(itemRows.map((r) => [r.id, r.name]));
  const native = computeCashflowLines(byItem, nameById, await getCostMethod());

  // Resolve FX rates for every distinct source currency.
  const fromCurrencies = new Set<string>();
  for (const l of native) {
    if (l.currency !== displayCurrency) fromCurrencies.add(l.currency);
  }
  const rateMap = new Map<string, number>();
  const rateResults = await Promise.all(
    Array.from(fromCurrencies).map(async (from) => {
      try {
        const r = await getRate(from as CurrencyCode, displayCurrency);
        return { from, ok: true as const, rate: r.rate };
      } catch {
        return { from, ok: false as const };
      }
    }),
  );
  for (const r of rateResults) {
    if (r.ok) rateMap.set(r.from, r.rate);
  }

  // An item can span currencies; fold those rows together per (month, item).
  const merged = new Map<string, WindowLine>();
  for (const l of native) {
    let { spend, revenue, realized, shipping } = l;
    if (l.currency !== displayCurrency) {
      const rate = rateMap.get(l.currency);
      if (rate == null) continue;
      const conv = (m: number) =>
        convertMinor(m, l.currency, displayCurrency, rate);
      spend = conv(spend);
      revenue = conv(revenue);
      realized = conv(realized);
      shipping = conv(shipping);
    }
    const key = `${l.month}|${l.itemId}`;
    const cur = merged.get(key);
    if (cur) {
      cur.spend += spend;
      cur.revenue += revenue;
      cur.realized += realized;
      cur.shipping += shipping;
      cur.buys += l.buys;
      cur.sells += l.sells;
      cur.unitsBought += l.unitsBought;
      cur.unitsSold += l.unitsSold;
    } else {
      merged.set(key, {
        month: l.month,
        itemId: l.itemId,
        itemName: l.itemName,
        spend,
        revenue,
        realized,
        shipping,
        buys: l.buys,
        sells: l.sells,
        unitsBought: l.unitsBought,
        unitsSold: l.unitsSold,
      });
    }
  }

  const lines = Array.from(merged.values()).sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  if (lines.length === 0) return { lines, bounds: null };
  return {
    lines,
    bounds: { first: lines[0].month, last: lines[lines.length - 1].month },
  };
}

export type PortfolioValuePoint = {
  date: Date;
  /** Total cost basis across every currency, converted to display currency. */
  costBasis: number;
  /** Total market value in display currency; null when no held item had a
   * market_prices row on/before this date, so the chart can hide the line. */
  marketValue: number | null;
  /** Held-item count across all currencies. */
  itemsHeld: number;
  /** How many held items contributed to `marketValue` (for the tooltip). */
  itemsWithPrice: number;
};

/**
 * Weekly portfolio value snapshots (cost basis + market value) over the
 * last `weeksBack` weeks, all in `displayCurrency`. Market value is `null`
 * until at least one held item has a `market_prices` row on/before the
 * snapshot — so the chart can hide the line for pre-tracking history.
 */
export async function getPortfolioValueSeries(
  displayCurrency: CurrencyCode,
  opts: { weeksBack?: number } = {},
): Promise<PortfolioValuePoint[]> {
  const weeksBack = opts.weeksBack ?? 26;
  const snapshotDates = weeklySnapshotDates(weeksBack);

  const [allTxs, allPrices] = await Promise.all([
    db.select().from(transactions),
    db.select().from(marketPrices),
  ]);
  if (allTxs.length === 0) return [];

  const txsByItem = new Map<string, typeof allTxs>();
  const itemCurrencyById = new Map<string, string>();
  for (const t of allTxs) {
    const list = txsByItem.get(t.itemId) ?? [];
    list.push(t);
    txsByItem.set(t.itemId, list);
    // computeHoldings enforces one currency per item; grab the first.
    if (!itemCurrencyById.has(t.itemId)) {
      itemCurrencyById.set(t.itemId, t.currency);
    }
  }
  const pricesByItem = new Map<string, typeof allPrices>();
  for (const p of allPrices) {
    const list = pricesByItem.get(p.itemId) ?? [];
    list.push(p);
    pricesByItem.set(p.itemId, list);
  }

  const snapshots = computePortfolioSnapshots(
    snapshotDates,
    txsByItem,
    pricesByItem,
    itemCurrencyById,
    await getCostMethod(),
  );

  // Resolve FX rates for every non-display currency appearing anywhere.
  const fromCurrencies = new Set<string>();
  for (const snap of snapshots) {
    for (const b of snap.buckets) {
      if (b.currency !== displayCurrency) fromCurrencies.add(b.currency);
    }
  }
  const rateMap = new Map<string, number>();
  const rateResults = await Promise.all(
    Array.from(fromCurrencies).map(async (from) => {
      try {
        const r = await getRate(from as CurrencyCode, displayCurrency);
        return { from, ok: true as const, rate: r.rate };
      } catch {
        return { from, ok: false as const };
      }
    }),
  );
  for (const r of rateResults) {
    if (r.ok) rateMap.set(r.from, r.rate);
  }

  return snapshots.map((snap) => {
    let costBasis = 0;
    let marketValue = 0;
    let anyMarketValue = false;
    let itemsWithPrice = 0;
    for (const b of snap.buckets) {
      const rate = b.currency === displayCurrency ? 1 : rateMap.get(b.currency);
      if (rate == null) continue; // FX missing — skip this bucket's contribution
      const conv = (m: number) =>
        b.currency === displayCurrency
          ? m
          : convertMinor(m, b.currency, displayCurrency, rate);
      costBasis += conv(b.costBasis);
      if (b.marketValue != null) {
        marketValue += conv(b.marketValue);
        anyMarketValue = true;
        itemsWithPrice += b.itemsWithPrice;
      }
    }
    return {
      date: snap.date,
      costBasis,
      marketValue: anyMarketValue ? marketValue : null,
      itemsHeld: snap.itemsHeld,
      itemsWithPrice,
    };
  });
}
