import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { items, transactions, type Transaction } from "@/db/schema";
import {
  DAYS_HELD_EDGES,
  DAYS_HELD_LABELS,
  MARGIN_PCT_EDGES,
  MARGIN_PCT_LABELS,
  MS_PER_DAY,
  makeHistogram,
  replayForAnalytics,
  type Bucket,
  type HeldLot,
  type SellAnalytic,
} from "@/lib/calc/analytics";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export type HeadlineStats = {
  realizedTotal: number;
  sellsCount: number;
  winRatePct: number; // 0..100
  avgMarginPct: number | null;
  avgDaysHeld: number | null;
  capitalTiedUp: number; // inventory cost (in stock only)
  itemsInStock: number;
  itemsOnTheWay: number;
};

export type LotResult = {
  itemId: string;
  itemName: string;
  buyDate: Date;
  sellDate: Date;
  daysHeld: number;
  buyCents: number;
  sellCents: number;
  realizedNativeCents: number;
  realizedDisplayCents: number;
  marginPct: number | null;
  currency: string;
};

/**
 * Aggregated performance for one item across every completed sell.
 * Used for the winners / losers leaderboards so a single multi-lot item
 * appears once with its net result instead of dominating the list.
 */
export type ItemPerformance = {
  itemId: string;
  itemName: string;
  /** Number of distinct sell events (transactions). */
  sellsCount: number;
  /** Total units sold across all sells (sum of tx.quantity). */
  unitsSold: number;
  /** Sum of realized profit across all of the item's sells (display ccy). */
  totalRealizedDisplay: number;
  /** Sum of cost basis consumed by sells (display ccy). */
  totalCostDisplay: number;
  /** Sum of sell value (display ccy). */
  totalSellDisplay: number;
  /** Cost-weighted average margin %. Null when totalCost is 0. */
  avgMarginPct: number | null;
  /** Quantity-weighted average days held across all sells. */
  avgDaysHeld: number | null;
  firstSellDate: Date;
  lastSellDate: Date;
};

export type SlowMover = {
  itemId: string;
  itemName: string;
  buyDate: Date;
  daysHeld: number;
  qty: number;
  costNativeCents: number;
  costDisplayCents: number;
  currency: string;
};

export type TagScorecard = {
  tag: string;
  itemCount: number;
  sellsCount: number;
  winsCount: number;
  winRatePct: number;
  avgMarginPct: number | null;
  avgDaysHeld: number | null;
  totalRealized: number;
  totalSpent: number;
  roiPct: number | null;
};

export type SameItemRow = {
  itemId: string;
  itemName: string;
  /** Number of "lots" — completed rounds + open positions counted as 1 each. */
  lotCount: number;
  /** Each lot summarized for the comparator table. */
  lots: {
    label: string;
    buyDate: Date;
    sellDate: Date | null;
    buyCents: number;
    sellCents: number | null;
    realizedNativeCents: number | null;
    marginPct: number | null;
    daysHeld: number | null;
    currency: string;
  }[];
};

export type AnalyticsData = {
  headline: HeadlineStats;
  displayCurrency: CurrencyCode;
  daysHeldHistogram: Bucket[];
  marginHistogram: Bucket[];
  topWinners: ItemPerformance[];
  topLosers: ItemPerformance[];
  slowMovers: SlowMover[];
  tagScorecards: TagScorecard[];
  sameItem: SameItemRow[];
};

/* ------------------------------------------------------------------ */
/* Loader                                                              */
/* ------------------------------------------------------------------ */

const SLOW_MOVER_DAYS_THRESHOLD = 90;
const TOP_LIST_SIZE = 10;
const SAME_ITEM_MIN_LOTS = 2;
const SAME_ITEM_MAX_ITEMS = 20;

export async function getAnalyticsData(
  displayCurrency: CurrencyCode,
): Promise<AnalyticsData> {
  const [allItems, allTxs] = await Promise.all([
    db.select().from(items).orderBy(asc(items.name)),
    db.select().from(transactions),
  ]);

  // Group transactions by item.
  const byItem = new Map<string, Transaction[]>();
  for (const tx of allTxs) {
    const list = byItem.get(tx.itemId) ?? [];
    list.push(tx);
    byItem.set(tx.itemId, list);
  }

  // Per-item analytics replay.
  type ItemAnalytics = {
    item: (typeof allItems)[number];
    sells: SellAnalytic[];
    heldLots: HeldLot[];
    pendingQty: number;
  };
  const perItem: ItemAnalytics[] = [];
  const now = new Date();
  for (const it of allItems) {
    const list = byItem.get(it.id) ?? [];
    const { sells, remaining } = replayForAnalytics(list);
    const heldLots: HeldLot[] = remaining.map((r) => ({
      itemId: it.id,
      buyTxId: r.buyTxId,
      buyDate: r.buyDate,
      qty: r.qty,
      costCents: r.cost,
      daysHeld: Math.max(
        0,
        (now.getTime() - r.buyDate.getTime()) / MS_PER_DAY,
      ),
    }));
    const pendingQty = list
      .filter((t) => t.type === "buy" && t.status === "pending")
      .reduce((s, t) => s + t.quantity, 0);
    perItem.push({ item: it, sells, heldLots, pendingQty });
  }

  // Resolve FX rates for every distinct non-display currency the data uses.
  const fromCurrencies = new Set<string>();
  for (const it of perItem) {
    for (const t of byItem.get(it.item.id) ?? []) {
      if (t.currency !== displayCurrency) fromCurrencies.add(t.currency);
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
  function toDisplay(amountMinor: number, from: string): number | null {
    if (from === displayCurrency) return amountMinor;
    const rate = rateMap.get(from);
    if (rate == null) return null;
    return convertMinor(amountMinor, from, displayCurrency, rate);
  }

  // Build flat lists across all items.
  const allLotResults: LotResult[] = [];
  const allSlowMovers: SlowMover[] = [];

  for (const ia of perItem) {
    const currency = (byItem.get(ia.item.id) ?? [])[0]?.currency ?? displayCurrency;
    for (const s of ia.sells) {
      const dispRealized = toDisplay(s.realizedCents, currency);
      if (dispRealized == null) continue;
      allLotResults.push({
        itemId: ia.item.id,
        itemName: ia.item.name,
        buyDate: new Date(
          s.sellDate.getTime() - s.daysHeldAvg * MS_PER_DAY,
        ),
        sellDate: s.sellDate,
        daysHeld: s.daysHeldAvg,
        buyCents: s.consumedCostCents,
        sellCents: s.sellValueCents,
        realizedNativeCents: s.realizedCents,
        realizedDisplayCents: dispRealized,
        marginPct: s.marginPct,
        currency,
      });
    }
    for (const h of ia.heldLots) {
      if (h.daysHeld < SLOW_MOVER_DAYS_THRESHOLD) continue;
      const disp = toDisplay(h.costCents, currency);
      if (disp == null) continue;
      allSlowMovers.push({
        itemId: ia.item.id,
        itemName: ia.item.name,
        buyDate: h.buyDate,
        daysHeld: h.daysHeld,
        qty: h.qty,
        costNativeCents: h.costCents,
        costDisplayCents: disp,
        currency,
      });
    }
  }

  // Headline stats.
  let realizedTotal = 0;
  let winsCount = 0;
  let marginSum = 0;
  let marginCount = 0;
  let daysSum = 0;
  let daysCount = 0;
  for (const r of allLotResults) {
    realizedTotal += r.realizedDisplayCents;
    if (r.realizedDisplayCents > 0) winsCount += 1;
    if (r.marginPct != null) {
      marginSum += r.marginPct;
      marginCount += 1;
    }
    daysSum += r.daysHeld;
    daysCount += 1;
  }
  let capitalTiedUp = 0;
  let itemsInStock = 0;
  let itemsOnTheWay = 0;
  for (const ia of perItem) {
    const currency = (byItem.get(ia.item.id) ?? [])[0]?.currency ?? displayCurrency;
    const inv = ia.heldLots.reduce((s, h) => s + h.costCents, 0);
    if (inv > 0) {
      const disp = toDisplay(inv, currency);
      if (disp != null) {
        capitalTiedUp += disp;
        itemsInStock += 1;
      }
    } else if (ia.pendingQty > 0) {
      itemsOnTheWay += 1;
    }
  }

  const headline: HeadlineStats = {
    realizedTotal,
    sellsCount: allLotResults.length,
    winRatePct:
      allLotResults.length === 0
        ? 0
        : (winsCount / allLotResults.length) * 100,
    avgMarginPct: marginCount === 0 ? null : marginSum / marginCount,
    avgDaysHeld: daysCount === 0 ? null : daysSum / daysCount,
    capitalTiedUp,
    itemsInStock,
    itemsOnTheWay,
  };

  // Histograms.
  const daysHeldHistogram = makeHistogram(
    allLotResults.map((r) => r.daysHeld),
    DAYS_HELD_EDGES,
    DAYS_HELD_LABELS,
  );
  const marginValues: number[] = [];
  for (const r of allLotResults) {
    if (r.marginPct != null) marginValues.push(r.marginPct);
  }
  const marginHistogram = makeHistogram(
    marginValues,
    MARGIN_PCT_EDGES,
    MARGIN_PCT_LABELS,
  );

  // Per-item aggregation for top winners / losers — collapses multi-lot
  // items into a single net-result row so the leaderboard isn't dominated
  // by one item's repeated lots.
  type ItemAgg = {
    itemId: string;
    itemName: string;
    sellsCount: number;
    unitsSold: number;
    totalRealized: number;
    totalCost: number;
    totalSell: number;
    daysWeightedSum: number;
    daysWeightedQty: number;
    firstSell: number;
    lastSell: number;
  };
  const itemAggs = new Map<string, ItemAgg>();

  // Walk each item's sells directly (rather than the flat allLotResults)
  // so we can sum tx.quantity into unitsSold and weight days-held by qty.
  for (const ia of perItem) {
    const currency =
      (byItem.get(ia.item.id) ?? [])[0]?.currency ?? displayCurrency;
    for (const s of ia.sells) {
      const dispCost = toDisplay(s.consumedCostCents, currency);
      const dispSell = toDisplay(s.sellValueCents, currency);
      const dispRealized = toDisplay(s.realizedCents, currency);
      if (dispCost == null || dispSell == null || dispRealized == null) continue;
      let agg = itemAggs.get(ia.item.id);
      if (!agg) {
        agg = {
          itemId: ia.item.id,
          itemName: ia.item.name,
          sellsCount: 0,
          unitsSold: 0,
          totalRealized: 0,
          totalCost: 0,
          totalSell: 0,
          daysWeightedSum: 0,
          daysWeightedQty: 0,
          firstSell: s.sellDate.getTime(),
          lastSell: s.sellDate.getTime(),
        };
        itemAggs.set(ia.item.id, agg);
      }
      agg.sellsCount += 1;
      agg.unitsSold += s.quantity;
      agg.totalRealized += dispRealized;
      agg.totalCost += dispCost;
      agg.totalSell += dispSell;
      // Weight days-held by units sold so a 60-unit sell doesn't get the
      // same weight as a 1-unit sell.
      agg.daysWeightedSum += s.daysHeldAvg * s.quantity;
      agg.daysWeightedQty += s.quantity;
      if (s.sellDate.getTime() < agg.firstSell)
        agg.firstSell = s.sellDate.getTime();
      if (s.sellDate.getTime() > agg.lastSell)
        agg.lastSell = s.sellDate.getTime();
    }
  }

  const itemPerformances: ItemPerformance[] = Array.from(itemAggs.values())
    .map((a) => ({
      itemId: a.itemId,
      itemName: a.itemName,
      sellsCount: a.sellsCount,
      unitsSold: a.unitsSold,
      totalRealizedDisplay: a.totalRealized,
      totalCostDisplay: a.totalCost,
      totalSellDisplay: a.totalSell,
      avgMarginPct:
        a.totalCost === 0 ? null : (a.totalRealized / a.totalCost) * 100,
      avgDaysHeld:
        a.daysWeightedQty === 0
          ? null
          : a.daysWeightedSum / a.daysWeightedQty,
      firstSellDate: new Date(a.firstSell),
      lastSellDate: new Date(a.lastSell),
    }))
    .sort((a, b) => b.totalRealizedDisplay - a.totalRealizedDisplay);

  const topWinners = itemPerformances
    .filter((p) => p.totalRealizedDisplay > 0)
    .slice(0, TOP_LIST_SIZE);
  const topLosers = itemPerformances
    .filter((p) => p.totalRealizedDisplay < 0)
    .slice(-TOP_LIST_SIZE)
    .reverse();

  // Slow movers — by display-currency cost desc.
  allSlowMovers.sort((a, b) => b.costDisplayCents - a.costDisplayCents);

  // Per-tag scorecard.
  type TagBucket = {
    items: Set<string>;
    sellsCount: number;
    winsCount: number;
    marginSum: number;
    marginCount: number;
    daysSum: number;
    daysCount: number;
    realized: number;
    spent: number;
  };
  const tagBuckets = new Map<string, TagBucket>();
  function ensureTag(t: string): TagBucket {
    let b = tagBuckets.get(t);
    if (!b) {
      b = {
        items: new Set(),
        sellsCount: 0,
        winsCount: 0,
        marginSum: 0,
        marginCount: 0,
        daysSum: 0,
        daysCount: 0,
        realized: 0,
        spent: 0,
      };
      tagBuckets.set(t, b);
    }
    return b;
  }
  for (const ia of perItem) {
    const currency = (byItem.get(ia.item.id) ?? [])[0]?.currency ?? displayCurrency;
    for (const tag of ia.item.tags) {
      const b = ensureTag(tag);
      b.items.add(ia.item.id);
      for (const s of ia.sells) {
        const dispRealized = toDisplay(s.realizedCents, currency);
        const dispCost = toDisplay(s.consumedCostCents, currency);
        if (dispRealized == null || dispCost == null) continue;
        b.sellsCount += 1;
        if (dispRealized > 0) b.winsCount += 1;
        if (s.marginPct != null) {
          b.marginSum += s.marginPct;
          b.marginCount += 1;
        }
        b.daysSum += s.daysHeldAvg;
        b.daysCount += 1;
        b.realized += dispRealized;
        b.spent += dispCost;
      }
    }
  }
  const tagScorecards: TagScorecard[] = Array.from(tagBuckets.entries())
    .map(([tag, b]) => ({
      tag,
      itemCount: b.items.size,
      sellsCount: b.sellsCount,
      winsCount: b.winsCount,
      winRatePct: b.sellsCount === 0 ? 0 : (b.winsCount / b.sellsCount) * 100,
      avgMarginPct: b.marginCount === 0 ? null : b.marginSum / b.marginCount,
      avgDaysHeld: b.daysCount === 0 ? null : b.daysSum / b.daysCount,
      totalRealized: b.realized,
      totalSpent: b.spent,
      roiPct: b.spent === 0 ? null : (b.realized / b.spent) * 100,
    }))
    .sort((a, b) => b.totalRealized - a.totalRealized);

  // Same-item comparator: items with multiple lots/sells.
  const sameItem: SameItemRow[] = [];
  for (const ia of perItem) {
    const totalLots = ia.sells.length + ia.heldLots.length;
    if (totalLots < SAME_ITEM_MIN_LOTS) continue;
    const currency = (byItem.get(ia.item.id) ?? [])[0]?.currency ?? displayCurrency;
    const lots: SameItemRow["lots"] = [];
    let idx = 1;
    for (const s of ia.sells) {
      lots.push({
        label: `Lot ${idx++}`,
        buyDate: new Date(s.sellDate.getTime() - s.daysHeldAvg * MS_PER_DAY),
        sellDate: s.sellDate,
        buyCents: s.consumedCostCents,
        sellCents: s.sellValueCents,
        realizedNativeCents: s.realizedCents,
        marginPct: s.marginPct,
        daysHeld: s.daysHeldAvg,
        currency,
      });
    }
    for (const h of ia.heldLots) {
      lots.push({
        label: `Lot ${idx++} (held)`,
        buyDate: h.buyDate,
        sellDate: null,
        buyCents: h.costCents,
        sellCents: null,
        realizedNativeCents: null,
        marginPct: null,
        daysHeld: h.daysHeld,
        currency,
      });
    }
    // Sort lots by buy date for a readable timeline.
    lots.sort((a, b) => a.buyDate.getTime() - b.buyDate.getTime());
    sameItem.push({
      itemId: ia.item.id,
      itemName: ia.item.name,
      lotCount: totalLots,
      lots,
    });
  }
  // Most lots first; cap to keep page snappy.
  sameItem.sort((a, b) => b.lotCount - a.lotCount);
  const sameItemTruncated = sameItem.slice(0, SAME_ITEM_MAX_ITEMS);

  return {
    headline,
    displayCurrency,
    daysHeldHistogram,
    marginHistogram,
    topWinners,
    topLosers,
    slowMovers: allSlowMovers.slice(0, TOP_LIST_SIZE),
    tagScorecards,
    sameItem: sameItemTruncated,
  };
}
