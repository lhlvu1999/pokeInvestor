/**
 * Loader for the dashboard's capital-deployed card. A pure read (no "use
 * server"), so it is not exposed as a client-callable action.
 */

import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import {
  computeCapitalFlow,
  fundingByPurchase,
  fundingKind,
  type CapitalEvent,
  type CapitalFlow,
  type FundingKind,
} from "@/lib/calc/capital";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";

/**
 * Every buy and sell in the display currency, with its id. Transactions in
 * a currency with no available rate are left out and counted, so callers
 * can say so instead of quietly understating.
 */
async function loadCapitalEvents(
  displayCurrency: CurrencyCode,
): Promise<{ events: (CapitalEvent & { id: string })[]; skipped: number }> {
  const rows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.finalValueCents,
      currency: transactions.currency,
      at: transactions.occurredAt,
    })
    .from(transactions)
    // Two purchases can share a timestamp (imports do), and then whichever
    // is replayed first gets the sale proceeds. Pin that order — entered
    // first, then id — so the answer is the same on every load.
    .orderBy(
      asc(transactions.occurredAt),
      asc(transactions.createdAt),
      asc(transactions.id),
    );

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

  const events: (CapitalEvent & { id: string })[] = [];
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
    events.push({ id: r.id, at: r.at, type: r.type, amount });
  }
  return { events, skipped };
}

/** The whole-portfolio capital flow behind the dashboard card. */
export async function getCapitalFlow(
  displayCurrency: CurrencyCode,
): Promise<{ flow: CapitalFlow; skipped: number }> {
  const { events, skipped } = await loadCapitalEvents(displayCurrency);
  return { flow: computeCapitalFlow(events), skipped };
}

/**
 * How each purchase was funded (new money / earlier sales / a mix), keyed by
 * transaction id, for the History filter. Purchases that couldn't be
 * converted are simply absent.
 */
export async function getPurchaseFunding(
  displayCurrency: CurrencyCode,
): Promise<Record<string, FundingKind>> {
  const { events } = await loadCapitalEvents(displayCurrency);
  const out: Record<string, FundingKind> = {};
  for (const [id, f] of fundingByPurchase(events)) {
    const kind = fundingKind(f);
    if (kind) out[id] = kind;
  }
  return out;
}
