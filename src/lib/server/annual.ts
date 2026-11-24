import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { items, transactions, type Transaction } from "@/db/schema";
import { replayForAnalytics, type SellAnalytic } from "@/lib/calc/analytics";
import type { SaleLine } from "@/lib/calc/annual";
import { convertSale, daysNeeded, type ForeignSale } from "@/lib/calc/fx_history";
import { loadDayRates } from "./fx_history";
import { displayExitReason } from "@/lib/calc/exit_reason";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import { getCostMethod } from "./settings";

/**
 * Every unit that left stock, one line per sell transaction, with its cost
 * under the chosen cost method. The native amounts are what actually changed
 * hands. Display amounts for another currency use the exchange rate of the day
 * of the sale (and of each purchase, for cost); today's rate only fills in for a
 * day with no rate, and such a line is marked `approx`.
 */
export async function getSaleLines(
  displayCurrency: CurrencyCode,
): Promise<SaleLine[]> {
  const [allItems, allTxs, method] = await Promise.all([
    db.select().from(items).orderBy(asc(items.name)),
    db.select().from(transactions),
    getCostMethod(),
  ]);

  const byItem = new Map<string, Transaction[]>();
  for (const tx of allTxs) {
    const list = byItem.get(tx.itemId) ?? [];
    list.push(tx);
    byItem.set(tx.itemId, list);
  }

  const currencies = new Set<string>();
  for (const tx of allTxs) {
    if (tx.currency !== displayCurrency) currencies.add(tx.currency);
  }
  const rates = new Map<string, number>();
  await Promise.all(
    [...currencies].map(async (from) => {
      try {
        rates.set(
          from,
          (await getRate(from as CurrencyCode, displayCurrency)).rate,
        );
      } catch {
        // Left unconverted; the report says how many lines that affects.
      }
    }),
  );
  const toShown = (minor: number, from: string): number | null => {
    if (from === displayCurrency) return minor;
    const rate = rates.get(from);
    return rate == null
      ? null
      : convertMinor(minor, from, displayCurrency, rate);
  };

  // First pass: every sell with what it cost and where that cost came from.
  type Raw = { it: (typeof allItems)[number]; currency: string; s: SellAnalytic };
  const raw: Raw[] = [];
  for (const it of allItems) {
    const list = byItem.get(it.id) ?? [];
    if (list.length === 0) continue;
    // Same currency rule as the Analytics page: the item's first transaction.
    const currency = list[0].currency;
    for (const s of replayForAnalytics(list, method).sells) raw.push({ it, currency, s });
  }

  // Sales in another currency are converted at the rate of the day they
  // happened (proceeds) and the day each unit was bought (cost). Sales in the
  // display currency need no rates, so a one-currency ledger never fetches any.
  const foreign = raw.filter((r) => r.currency !== displayCurrency);
  const asForeign = (r: Raw): ForeignSale => ({
    soldOn: r.s.sellDate,
    currency: r.currency,
    proceeds: r.s.sellValueCents,
    costLots: r.s.costLots,
  });
  const byDay = foreign.length > 0 ? await loadDayRates(daysNeeded(foreign.map(asForeign))) : new Map();

  const lines: SaleLine[] = [];
  for (const { it, currency, s } of raw) {
    let shown: SaleLine["shown"] = null;
    let approx = false;
    if (currency === displayCurrency) {
      shown = {
        proceeds: s.sellValueCents,
        cost: s.consumedCostCents,
        realized: s.realizedCents,
      };
    } else {
      const c = convertSale(
        asForeign({ it, currency, s }),
        displayCurrency,
        byDay,
        toShown,
      );
      if (c) {
        shown = { proceeds: c.proceeds, cost: c.cost, realized: c.realized };
        approx = c.approx;
      }
    }
    lines.push({
      txId: s.sellTxId,
      itemId: it.id,
      itemName: it.name,
      soldOn: s.sellDate,
      qty: s.quantity,
      reason: displayExitReason(s.exitReason),
      proceeds: s.sellValueCents,
      cost: s.consumedCostCents,
      realized: s.realizedCents,
      currency,
      daysHeld: s.daysHeldAvg,
      shown,
      approx,
    });
  }
  return lines;
}
