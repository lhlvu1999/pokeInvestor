/**
 * Orders you've paid for but haven't received (buy transactions with
 * status = 'pending'), rolled up for the dashboard's attention queue.
 *
 * Pure read (no "use server") so it isn't exposed as a client-callable
 * action.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";

export type PendingDeliveries = {
  units: number;
  /** Distinct items with something on the way. */
  itemCount: number;
  /** Total paid for undelivered goods, in display currency. */
  costDisplay: number;
  /** Purchase date of the longest-waiting order. */
  oldestAt: Date | null;
};

export async function getPendingDeliveries(
  displayCurrency: CurrencyCode,
): Promise<PendingDeliveries> {
  const rows = await db
    .select({
      itemId: transactions.itemId,
      quantity: transactions.quantity,
      finalValueCents: transactions.finalValueCents,
      currency: transactions.currency,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(
      and(eq(transactions.type, "buy"), eq(transactions.status, "pending")),
    );

  if (rows.length === 0) {
    return { units: 0, itemCount: 0, costDisplay: 0, oldestAt: null };
  }

  // One FX lookup per distinct foreign currency, not per row.
  const foreign = Array.from(
    new Set(rows.map((r) => r.currency).filter((c) => c !== displayCurrency)),
  );
  const rates = new Map<string, number>();
  await Promise.all(
    foreign.map(async (from) => {
      try {
        const { rate } = await getRate(from as CurrencyCode, displayCurrency);
        rates.set(from, rate);
      } catch {
        // Leave unset: that order still counts as units on the way, but
        // its cost is left out of the total rather than guessed.
      }
    }),
  );

  let units = 0;
  let costDisplay = 0;
  let oldestAt: Date | null = null;
  const items = new Set<string>();

  for (const r of rows) {
    units += r.quantity;
    items.add(r.itemId);
    if (!oldestAt || r.occurredAt < oldestAt) oldestAt = r.occurredAt;

    if (r.currency === displayCurrency) {
      costDisplay += r.finalValueCents;
    } else {
      const rate = rates.get(r.currency);
      if (rate != null) {
        costDisplay += convertMinor(
          r.finalValueCents,
          r.currency,
          displayCurrency,
          rate,
        );
      }
    }
  }

  return { units, itemCount: items.size, costDisplay, oldestAt };
}
