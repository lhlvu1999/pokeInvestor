import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import {
  type ConvertedItemValues,
  summarizePortfolio,
  type PortfolioSummary,
} from "@/lib/calc/portfolio";
import {
  groupByMonthCurrency,
  replayItemEvents,
  type CashflowBucket,
} from "@/lib/calc/cashflow";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import {
  listItemsWithValuations,
  type ItemWithValuation,
} from "./items";

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

export type MonthlyCashflow = {
  month: string; // "YYYY-MM"
  spend: number;
  revenue: number;
  realized: number;
  /** Shipping portion of `spend` for the month, in display currency. */
  shipping: number;
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

  const converted: ConvertedItemValues[] = items.map(({ valuation }) => {
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
    };
  });

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

/**
 * Per-month cashflow (spend, revenue, realized profit), converted to
 * `displayCurrency`. Realized profit is computed via specific-lot + FIFO
 * replay per item, matching computeHoldings.
 */
export async function getMonthlyCashflow(
  displayCurrency: CurrencyCode,
  filter: CashflowFilter = {},
): Promise<MonthlyCashflow[]> {
  const txs = await db.select().from(transactions);
  if (txs.length === 0) return [];

  const byItem = new Map<string, typeof txs>();
  for (const t of txs) {
    if (filter.itemIdsFilter && !filter.itemIdsFilter.has(t.itemId)) continue;
    const list = byItem.get(t.itemId) ?? [];
    list.push(t);
    byItem.set(t.itemId, list);
  }

  const allEvents: CashflowBucket[] = [];
  for (const list of byItem.values()) {
    allEvents.push(...replayItemEvents(list));
  }
  const grouped = groupByMonthCurrency(allEvents);

  // Resolve FX rates for every distinct (from, to) pair we'll need.
  const fromCurrencies = new Set<string>();
  for (const g of grouped) {
    if (g.currency !== displayCurrency) fromCurrencies.add(g.currency);
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

  const monthly = new Map<string, MonthlyCashflow>();
  for (const g of grouped) {
    let spend = g.spend;
    let revenue = g.revenue;
    let realized = g.realized;
    let shipping = g.shipping;
    if (g.currency !== displayCurrency) {
      const rate = rateMap.get(g.currency);
      if (rate == null) continue;
      const conv = (m: number) =>
        convertMinor(m, g.currency, displayCurrency, rate);
      spend = conv(spend);
      revenue = conv(revenue);
      realized = conv(realized);
      shipping = conv(shipping);
    }
    const cur = monthly.get(g.month);
    if (cur) {
      cur.spend += spend;
      cur.revenue += revenue;
      cur.realized += realized;
      cur.shipping += shipping;
    } else {
      monthly.set(g.month, {
        month: g.month,
        spend,
        revenue,
        realized,
        shipping,
      });
    }
  }

  return Array.from(monthly.values()).sort((a, b) =>
    a.month.localeCompare(b.month),
  );
}
