/**
 * Loader for the dashboard's annualized-return card. A pure read (no "use
 * server"), so it is not exposed as a client-callable action.
 */

import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import {
  computeReturn,
  type ReturnEvent,
  type ReturnReport,
} from "@/lib/calc/annualized";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import type { DashboardData } from "@/lib/server/portfolio";

export type AnnualizedData = {
  report: ReturnReport;
  /**
   * Part of today's value that is NOT a market price: unpriced stock and
   * paid-for-but-not-arrived stock, both counted at what you paid. The card
   * says so, because it pulls the return toward zero.
   */
  atCostValue: number;
  /** Transactions left out for lack of an exchange rate. */
  skipped: number;
};

/**
 * Whole-portfolio annualized return in the display currency.
 *
 * Takes the dashboard data the page has already loaded, so today's value of
 * the stock is exactly the figure shown in the hero, not a second reading
 * that could differ.
 */
export async function getAnnualizedReturn(
  dash: DashboardData,
  displayCurrency: CurrencyCode,
  now: Date,
): Promise<AnnualizedData> {
  const rows = await db
    .select({
      type: transactions.type,
      amount: transactions.finalValueCents,
      currency: transactions.currency,
      at: transactions.occurredAt,
    })
    .from(transactions);

  const rates = new Map<string, number>();
  for (const n of dash.fxNotes) rates.set(n.from, n.rate);

  const toDisplay = (amount: number, currency: string): number | null => {
    if (currency === displayCurrency) return amount;
    const rate = rates.get(currency);
    if (rate == null) return null;
    return convertMinor(amount, currency, displayCurrency, rate);
  };

  const events: ReturnEvent[] = [];
  let skipped = 0;
  for (const r of rows) {
    const amount = toDisplay(r.amount, r.currency);
    if (amount == null) {
      skipped += 1;
      continue;
    }
    events.push({ at: r.at, type: r.type, amount });
  }

  // Stock still held: priced units at market, the rest at cost. Paid-for
  // units still in the post are held too, at what was paid.
  let pendingCost = 0;
  for (const { valuation } of dash.items) {
    if (valuation.pendingCostCents <= 0) continue;
    const c = toDisplay(valuation.pendingCostCents, valuation.currency);
    if (c != null) pendingCost += c;
  }
  const atCostValue = dash.summary.investedUnpriced + pendingCost;
  const terminalValue = dash.summary.currentValue + atCostValue;

  return {
    report: computeReturn(events, terminalValue, now),
    atCostValue,
    skipped,
  };
}
