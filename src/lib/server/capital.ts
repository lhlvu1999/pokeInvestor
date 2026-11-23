/**
 * Loader for the dashboard's capital-deployed card. A pure read (no "use
 * server"), so it is not exposed as a client-callable action.
 */

import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import {
  computeCapitalFlow,
  type CapitalEvent,
  type CapitalFlow,
} from "@/lib/calc/capital";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";

/**
 * Every buy and sell in the display currency, replayed into one capital
 * flow. Transactions in a currency with no available rate are left out and
 * counted, so the card can say so instead of quietly understating.
 */
export async function getCapitalFlow(
  displayCurrency: CurrencyCode,
): Promise<{ flow: CapitalFlow; skipped: number }> {
  const rows = await db
    .select({
      type: transactions.type,
      amount: transactions.finalValueCents,
      currency: transactions.currency,
      at: transactions.occurredAt,
    })
    .from(transactions);

  const foreign = new Set(
    rows.map((r) => r.currency).filter((c) => c !== displayCurrency),
  );
  const rates = new Map<string, number>();
  await Promise.all(
    Array.from(foreign).map(async (from) => {
      try {
        const { rate } = await getRate(from as CurrencyCode, displayCurrency);
        rates.set(from, rate);
      } catch {
        // Unset: those rows are skipped below.
      }
    }),
  );

  const events: CapitalEvent[] = [];
  let skipped = 0;
  for (const r of rows) {
    let amount = r.amount;
    if (r.currency !== displayCurrency) {
      const rate = rates.get(r.currency);
      if (rate == null) {
        skipped += 1;
        continue;
      }
      amount = convertMinor(r.amount, r.currency, displayCurrency, rate);
    }
    events.push({ at: r.at, type: r.type, amount });
  }
  return { flow: computeCapitalFlow(events), skipped };
}
