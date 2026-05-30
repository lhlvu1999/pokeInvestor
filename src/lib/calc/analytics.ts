/**
 * Analytics-specific replay: emits per-sell and per-held-lot records derived
 * from the same lot/FIFO inventory model as `computeHoldings`. Used by the
 * analytics aggregator on the server.
 */

import type { Transaction } from "@/db/schema";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SellAnalytic = {
  sellTxId: string;
  sellDate: Date;
  /** Sell value in the item's native currency (minor units). */
  sellValueCents: number;
  /** Cost basis consumed for this sell (native minor units). */
  consumedCostCents: number;
  /** Realized profit = sellValue − consumedCost. */
  realizedCents: number;
  /** Margin % = realized / consumedCost × 100. Null when consumedCost is 0. */
  marginPct: number | null;
  /**
   * Weighted average days-held across the consumed units. Computed from the
   * actual buys consumed (which may span multiple lots / dates).
   */
  daysHeldAvg: number;
  /** Quantity sold. */
  quantity: number;
};

export type HeldLot = {
  itemId: string;
  /** Buy transaction id that originated this remaining lot fragment. */
  buyTxId: string;
  buyDate: Date;
  qty: number;
  /** Cost basis of the remaining qty (native minor units). */
  costCents: number;
  /** Days held from buyDate up to the `asOf` date. */
  daysHeld: number;
};

type TxInput = Pick<
  Transaction,
  | "id"
  | "type"
  | "quantity"
  | "finalValueCents"
  | "occurredAt"
  | "currency"
  | "lotId"
  | "status"
>;

type QueueEntry = {
  buyTxId: string;
  buyDate: Date;
  qty: number;
  cost: number;
  lotId: string | null;
};

/**
 * Replay one item's transactions chronologically using the same semantics as
 * computeHoldings: lot sells consume their own lot; null-lot sells FIFO
 * across any inventory; pending buys excluded from the queue.
 *
 * Returns the per-sell analytics + the remaining inventory queue
 * (consumers can map that to held-lot records).
 */
export function replayForAnalytics(
  txs: ReadonlyArray<TxInput>,
): { sells: SellAnalytic[]; remaining: QueueEntry[] } {
  if (txs.length === 0) return { sells: [], remaining: [] };

  const sorted = [...txs].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  const queue: QueueEntry[] = [];
  const sells: SellAnalytic[] = [];

  for (const tx of sorted) {
    if (tx.type === "buy") {
      if (tx.status === "pending") continue;
      queue.push({
        buyTxId: tx.id,
        buyDate: tx.occurredAt,
        qty: tx.quantity,
        cost: tx.finalValueCents,
        lotId: tx.lotId,
      });
      continue;
    }
    // Sell — consume from the queue (lot-specific or FIFO).
    let toSell = tx.quantity;
    let consumedCost = 0;
    // Weighted-days tracker.
    let weightedDaysSum = 0;
    let weightedQty = 0;

    for (const entry of queue) {
      if (toSell === 0) break;
      if (entry.qty === 0) continue;
      if (tx.lotId != null && entry.lotId !== tx.lotId) continue;
      const take = Math.min(toSell, entry.qty);
      const cost =
        take === entry.qty
          ? entry.cost
          : Math.round((entry.cost * take) / entry.qty);
      consumedCost += cost;
      const days = Math.max(
        0,
        (tx.occurredAt.getTime() - entry.buyDate.getTime()) / MS_PER_DAY,
      );
      weightedDaysSum += days * take;
      weightedQty += take;
      entry.qty -= take;
      entry.cost -= cost;
      toSell -= take;
    }
    // If the sell can't be fully satisfied here we simply emit what we can —
    // computeHoldings's stricter validation is the source of truth for
    // rejecting bad timelines. Analytics is best-effort.

    const marginPct =
      consumedCost === 0 ? null : ((tx.finalValueCents - consumedCost) / consumedCost) * 100;
    const daysHeldAvg = weightedQty > 0 ? weightedDaysSum / weightedQty : 0;

    sells.push({
      sellTxId: tx.id,
      sellDate: tx.occurredAt,
      sellValueCents: tx.finalValueCents,
      consumedCostCents: consumedCost,
      realizedCents: tx.finalValueCents - consumedCost,
      marginPct,
      daysHeldAvg,
      quantity: tx.quantity,
    });
  }

  return { sells, remaining: queue.filter((e) => e.qty > 0) };
}

/* ------------------------------------------------------------------ */
/* Histogram helpers                                                   */
/* ------------------------------------------------------------------ */

export type Bucket = {
  /** Inclusive lower bound of the bucket. */
  min: number;
  /** Exclusive upper bound (or +Infinity for the last bucket). */
  max: number;
  /** Display label. */
  label: string;
  /** Number of records falling in this bucket. */
  count: number;
};

export function makeHistogram(
  values: ReadonlyArray<number>,
  edges: ReadonlyArray<number>,
  labels: ReadonlyArray<string>,
): Bucket[] {
  if (edges.length !== labels.length + 1) {
    throw new Error("labels.length must be edges.length - 1");
  }
  const buckets: Bucket[] = labels.map((label, i) => ({
    min: edges[i],
    max: edges[i + 1],
    label,
    count: 0,
  }));
  for (const v of values) {
    // Linear scan is fine for small buckets count.
    for (const b of buckets) {
      if (v >= b.min && (v < b.max || b.max === Number.POSITIVE_INFINITY)) {
        b.count += 1;
        break;
      }
    }
  }
  return buckets;
}

export const DAYS_HELD_EDGES = [0, 7, 30, 90, 180, 365, Number.POSITIVE_INFINITY];
export const DAYS_HELD_LABELS = ["0–7d", "7–30d", "30–90d", "90–180d", "180–365d", "365d+"];

export const MARGIN_PCT_EDGES = [
  Number.NEGATIVE_INFINITY,
  -50,
  -25,
  0,
  25,
  50,
  100,
  Number.POSITIVE_INFINITY,
];
export const MARGIN_PCT_LABELS = [
  "< -50%",
  "-50% to -25%",
  "-25% to 0%",
  "0–25%",
  "25–50%",
  "50–100%",
  "100%+",
];
