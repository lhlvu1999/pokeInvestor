/**
 * Per-(month, item) cashflow lines — the raw material for the dashboard's
 * cashflow explorer.
 *
 * `cashflow.ts` rolls everything up to (month, currency), which is enough
 * for a bar chart but throws away WHICH items drove a month. A "what
 * happened in April?" view needs that, so this layer keeps the item and
 * the counts, and the explorer derives every total from these lines. That
 * way the chart, the summary tiles and the item breakdown can never
 * disagree: they are all sums of the same rows.
 *
 * Realized profit comes from the same replay as `computeHoldings`, so a
 * month's realized figure here matches the rest of the app.
 */

import type { Transaction } from "@/db/schema";
import { replayItemEvents } from "./cashflow";
import { DEFAULT_COST_METHOD, type CostMethod } from "./holdings";

export type CashflowLineTx = Pick<
  Transaction,
  | "type"
  | "quantity"
  | "finalValueCents"
  | "shippingCents"
  | "currency"
  | "occurredAt"
  | "lotId"
>;

/** One item's activity in one month, in the transactions' native currency. */
export type NativeCashflowLine = {
  month: string; // "YYYY-MM"
  itemId: string;
  itemName: string;
  currency: string;
  spend: number;
  revenue: number;
  realized: number;
  /** Shipping portion of `spend`. */
  shipping: number;
  /** Number of buy / sell transactions. */
  buys: number;
  sells: number;
  /** Units bought / sold (sum of quantities). */
  unitsBought: number;
  unitsSold: number;
};

export function computeCashflowLines(
  txsByItem: ReadonlyMap<string, ReadonlyArray<CashflowLineTx>>,
  nameById: ReadonlyMap<string, string>,
  method: CostMethod = DEFAULT_COST_METHOD,
): NativeCashflowLine[] {
  const lines = new Map<string, NativeCashflowLine>();

  for (const [itemId, txs] of txsByItem) {
    if (txs.length === 0) continue;

    // `replayItemEvents` returns one event per transaction in chronological
    // order. Sorting here with the same comparator (and a stable sort)
    // gives us the matching transaction for each event, which is how we
    // recover quantity and type without changing that function.
    const sorted = [...txs].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const events = replayItemEvents(sorted, method);
    const itemName = nameById.get(itemId) ?? "(unknown item)";

    for (let i = 0; i < sorted.length; i++) {
      const tx = sorted[i];
      const ev = events[i];
      const key = `${ev.month}|${itemId}|${ev.currency}`;
      let line = lines.get(key);
      if (!line) {
        line = {
          month: ev.month,
          itemId,
          itemName,
          currency: ev.currency,
          spend: 0,
          revenue: 0,
          realized: 0,
          shipping: 0,
          buys: 0,
          sells: 0,
          unitsBought: 0,
          unitsSold: 0,
        };
        lines.set(key, line);
      }
      line.spend += ev.spend;
      line.revenue += ev.revenue;
      line.realized += ev.realized;
      line.shipping += ev.shipping;
      if (tx.type === "buy") {
        line.buys += 1;
        line.unitsBought += tx.quantity;
      } else {
        line.sells += 1;
        line.unitsSold += tx.quantity;
      }
    }
  }

  return Array.from(lines.values()).sort((a, b) =>
    a.month === b.month
      ? a.itemName.localeCompare(b.itemName)
      : a.month.localeCompare(b.month),
  );
}
