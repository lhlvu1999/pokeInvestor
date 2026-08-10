/**
 * Portfolio-value snapshots for the dashboard "how am I doing over time?"
 * chart. Given a set of snapshot dates + all transactions + market prices,
 * produces one point per date with `costBasis` and (when data allows)
 * `marketValue` in each contributing currency.
 *
 * Currency-per-item is preserved through the calc; conversion to a single
 * display currency happens in the server layer (mirrors the pattern used
 * by `getMonthlyCashflow`).
 */

import type { MarketPrice, Transaction } from "@/db/schema";
import { computeHoldings, valueHoldings } from "./holdings";

export type NativeSnapshotBucket = {
  /** ISO 4217 currency code shared by every item contributing to this bucket. */
  currency: string;
  costBasis: number;
  /** Null when *no* held item in this currency has a market price on/before
   * the snapshot date. Zero is a real value (all items are worthless). */
  marketValue: number | null;
  /** Count of items with a market price applied (for the UI to say
   * "market value based on N/M items"). */
  itemsWithPrice: number;
};

export type PortfolioSnapshot = {
  /** End-of-day timestamp for this bucket (UTC midnight of the next day). */
  date: Date;
  /** One entry per currency that has any holdings on this date. */
  buckets: NativeSnapshotBucket[];
  /** Total held items across all currencies (informational). */
  itemsHeld: number;
};

type TxLike = Pick<
  Transaction,
  | "type"
  | "quantity"
  | "finalValueCents"
  | "occurredAt"
  | "currency"
  | "lotId"
  | "status"
  | "shippingCents"
>;

type PriceLike = Pick<MarketPrice, "priceCents" | "currency" | "fetchedAt">;

/**
 * Compute portfolio-value snapshots for the given dates.
 *
 * `txsByItem` and `pricesByItem` are keyed by `itemId`. Items with no
 * transactions are ignored — they never contribute cost basis. Items with
 * no market_prices row on/before a snapshot date contribute 0 to that
 * date's `marketValue` and do not count in `itemsWithPrice`.
 *
 * Cost complexity: O(snapshotDates × itemsHeld) — each snapshot re-runs
 * `computeHoldings` per item on the filtered tx slice. At the user's
 * scale (~500 txs, ~26 snapshots) this is comfortably under a second.
 */
export function computePortfolioSnapshots(
  snapshotDates: ReadonlyArray<Date>,
  txsByItem: ReadonlyMap<string, TxLike[]>,
  pricesByItem: ReadonlyMap<string, PriceLike[]>,
  itemCurrencyById: ReadonlyMap<string, string>,
): PortfolioSnapshot[] {
  // Pre-sort every price list once so `latestPriceOnOrBefore` can bisect.
  const sortedPrices = new Map<string, PriceLike[]>();
  for (const [itemId, prices] of pricesByItem) {
    sortedPrices.set(
      itemId,
      [...prices].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime()),
    );
  }

  return snapshotDates.map((snapshotDate) => {
    // Aggregate per currency.
    type Agg = {
      costBasis: number;
      marketValue: number;
      itemsWithPrice: number;
      hasAnyPrice: boolean;
    };
    const perCurrency = new Map<string, Agg>();
    let itemsHeld = 0;

    for (const [itemId, txs] of txsByItem) {
      const currency = itemCurrencyById.get(itemId);
      if (!currency) continue;

      // Filter to transactions on or before the snapshot date; skip items
      // that had no activity yet at that time.
      const filtered = txs.filter(
        (t) => t.occurredAt.getTime() <= snapshotDate.getTime(),
      );
      if (filtered.length === 0) continue;

      const snap = computeHoldings(filtered);
      if (snap.quantity === 0) continue;
      itemsHeld += 1;

      const valuation = valueHoldings(snap, null);
      const price = latestPriceOnOrBefore(
        sortedPrices.get(itemId) ?? [],
        snapshotDate,
      );

      const agg = perCurrency.get(currency) ?? {
        costBasis: 0,
        marketValue: 0,
        itemsWithPrice: 0,
        hasAnyPrice: false,
      };
      agg.costBasis += valuation.inventoryCostCents;
      if (price != null) {
        agg.marketValue += snap.quantity * price.priceCents;
        agg.itemsWithPrice += 1;
        agg.hasAnyPrice = true;
      }
      perCurrency.set(currency, agg);
    }

    const buckets: NativeSnapshotBucket[] = Array.from(
      perCurrency.entries(),
    ).map(([currency, agg]) => ({
      currency,
      costBasis: agg.costBasis,
      marketValue: agg.hasAnyPrice ? agg.marketValue : null,
      itemsWithPrice: agg.itemsWithPrice,
    }));

    return { date: snapshotDate, buckets, itemsHeld };
  });
}

/** Binary-search the sorted price list for the last row on/before `date`. */
function latestPriceOnOrBefore(
  sortedPrices: ReadonlyArray<PriceLike>,
  date: Date,
): PriceLike | null {
  if (sortedPrices.length === 0) return null;
  const ts = date.getTime();
  let lo = 0;
  let hi = sortedPrices.length - 1;
  let bestIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedPrices[mid].fetchedAt.getTime() <= ts) {
      bestIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return bestIdx === -1 ? null : sortedPrices[bestIdx];
}

/**
 * Generate weekly snapshot dates ending today (UTC), most-recent first
 * reversed to oldest-first for chart plotting. Bucket end is Sunday
 * 23:59:59 UTC.
 */
export function weeklySnapshotDates(weeksBack: number): Date[] {
  const dates: Date[] = [];
  const now = new Date();
  // Round to end-of-current-week (Sunday 23:59:59 UTC).
  const endOfWeek = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
    ),
  );
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat. Days remaining until Sunday.
  const daysToSunday = (7 - endOfWeek.getUTCDay()) % 7;
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + daysToSunday);

  for (let i = weeksBack - 1; i >= 0; i--) {
    const d = new Date(endOfWeek);
    d.setUTCDate(d.getUTCDate() - i * 7);
    dates.push(d);
  }
  return dates;
}
