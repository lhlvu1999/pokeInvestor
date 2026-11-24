/**
 * Loader for the stock-count page. A pure read (no "use server"), so it is
 * not exposed as a client-callable action; the action that books shortfalls
 * lives in `stock_count_actions.ts`.
 */

import type { CountRow } from "@/lib/calc/stock_count";
import type { CurrencyCode } from "@/lib/currency";
import { getDashboardData } from "@/lib/server/portfolio";

/**
 * Every item with units in hand, A to Z. Units on the way aren't counted
 * (they're in the post, not on a shelf). Cost is per unit in the display
 * currency so a shortage can be priced across a mixed-currency book.
 */
export async function getCountRows(
  displayCurrency: CurrencyCode,
): Promise<CountRow[]> {
  const { items, converted } = await getDashboardData(displayCurrency);
  const rows: CountRow[] = [];
  items.forEach(({ item, valuation }, i) => {
    if (valuation.quantity <= 0) return;
    const conv = converted[i];
    rows.push({
      itemId: item.id,
      name: item.name,
      ledger: valuation.quantity,
      avgCost:
        conv.quantity > 0 ? Math.round(conv.inventoryCost / conv.quantity) : 0,
    });
  });
  return rows;
}
