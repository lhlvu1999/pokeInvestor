/**
 * Aggregates buy/sell transactions into per-month cashflow buckets.
 * Realized profit per period uses the same unified-queue replay as
 * computeHoldings — lot sells consume their lot's buys, manual sells
 * consume FIFO across any available inventory.
 */

import type { Transaction } from "@/db/schema";

export type MonthKey = string; // "YYYY-MM"

export type CashflowBucket = {
  month: MonthKey;
  spend: number;
  revenue: number;
  realized: number;
  /**
   * Shipping portion of `spend` for the bucket (always 0 if shipping wasn't
   * separately tracked on the underlying transactions).
   */
  shipping: number;
  currency: string;
};

function monthKey(d: Date): MonthKey {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
}

type ItemReplayInput = Pick<
  Transaction,
  | "type"
  | "quantity"
  | "finalValueCents"
  | "shippingCents"
  | "currency"
  | "occurredAt"
  | "lotId"
>;

type Entry = { qty: number; cost: number; lotId: string | null };

/**
 * Replay one item's transactions chronologically into per-event cashflow
 * records. Each emitted record carries month, currency, and the per-event
 * spend / revenue / realized amounts.
 */
export function replayItemEvents(
  txs: ReadonlyArray<ItemReplayInput>,
): CashflowBucket[] {
  if (txs.length === 0) return [];

  const sorted = [...txs].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  const queue: Entry[] = [];
  const events: CashflowBucket[] = [];

  for (const tx of sorted) {
    const month = monthKey(tx.occurredAt);
    if (tx.type === "buy") {
      queue.push({
        qty: tx.quantity,
        cost: tx.finalValueCents,
        lotId: tx.lotId,
      });
      events.push({
        month,
        spend: tx.finalValueCents,
        revenue: 0,
        realized: 0,
        shipping: tx.shippingCents ?? 0,
        currency: tx.currency,
      });
      continue;
    }
    // Sell — consume by lot if lotId is set, else FIFO across all entries.
    let toSell = tx.quantity;
    let consumed = 0;
    for (const entry of queue) {
      if (toSell === 0) break;
      if (entry.qty === 0) continue;
      if (tx.lotId != null && entry.lotId !== tx.lotId) continue;
      const take = Math.min(toSell, entry.qty);
      const cost =
        take === entry.qty
          ? entry.cost
          : Math.round((entry.cost * take) / entry.qty);
      entry.qty -= take;
      entry.cost -= cost;
      consumed += cost;
      toSell -= take;
    }
    events.push({
      month,
      spend: 0,
      revenue: tx.finalValueCents,
      realized: tx.finalValueCents - consumed,
      shipping: 0,
      currency: tx.currency,
    });
  }

  return events;
}

/**
 * Group event records by (month, currency).
 */
export function groupByMonthCurrency(
  events: ReadonlyArray<CashflowBucket>,
): CashflowBucket[] {
  const map = new Map<string, CashflowBucket>();
  for (const e of events) {
    const key = `${e.month}|${e.currency}`;
    const cur = map.get(key);
    if (cur) {
      cur.spend += e.spend;
      cur.revenue += e.revenue;
      cur.realized += e.realized;
      cur.shipping += e.shipping;
    } else {
      map.set(key, { ...e });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}
