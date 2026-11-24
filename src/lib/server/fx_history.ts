import { and, between, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fxHistory } from "@/db/schema";
import {
  MAX_FALLBACK_DAYS,
  dayKey,
  parseRates,
  rateUrls,
  type DayRates,
} from "@/lib/calc/fx_history";

/**
 * Past exchange rates, fetched once and kept. Reached only from server code,
 * and only when a report needs a past rate (a sale in a foreign currency), so a
 * ledger kept in one currency never calls out.
 *
 * What leaves this machine: a request for a day's public rate file, whose URL
 * names that day. Nothing else about you is sent.
 */

/** The dataset starts here; earlier days do not exist, so they are never asked for. */
export const FIRST_RATE_DAY = "2024-03-02";
/** At most this many days are fetched in one request; the rest come on the next. */
const MAX_FETCH_PER_REQUEST = 60;
const CONCURRENCY = 6;
const TIMEOUT_MS = 6000;
/** A day that could not be fetched is not retried for this long. */
const RETRY_AFTER_MS = 60 * 60 * 1000;

const failedAt = new Map<string, number>();
const DAY_MS = 86_400_000;

async function fetchDay(day: string): Promise<DayRates | null> {
  for (const url of rateUrls(day)) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const rates = parseRates(await res.json(), day);
      if (rates) return rates;
    } catch {
      // Try the mirror, then give up on this day for now.
    }
  }
  return null;
}

async function inPool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Rates for each of `days` ("YYYY-MM-DD"), plus the few days before each so a
 * missing day can fall back to the closest earlier one. Days not stored yet are
 * fetched (a bounded number per call) and kept.
 */
export async function loadDayRates(
  days: readonly string[],
  now = new Date(),
): Promise<Map<string, DayRates>> {
  const out = new Map<string, DayRates>();
  if (days.length === 0) return out;
  const sorted = [...new Set(days)].sort();
  const from = dayKey(new Date(Date.parse(`${sorted[0]}T00:00:00Z`) - MAX_FALLBACK_DAYS * DAY_MS));
  const to = sorted[sorted.length - 1];

  const read = async () => {
    const rows = await db
      .select()
      .from(fxHistory)
      .where(and(between(fxHistory.day, from, to)));
    const m = new Map<string, DayRates>();
    for (const r of rows) {
      const rates = m.get(r.day) ?? { USD: 1 };
      rates[r.quote] = r.rate;
      m.set(r.day, rates);
    }
    return m;
  };
  const have = await read();

  const today = dayKey(now);
  const wanted = sorted
    .filter((d) => d >= FIRST_RATE_DAY && d <= today && !have.has(d))
    .filter((d) => now.getTime() - (failedAt.get(d) ?? 0) > RETRY_AFTER_MS)
    .slice(0, MAX_FETCH_PER_REQUEST);

  if (wanted.length > 0) {
    const fetched = await inPool(wanted, CONCURRENCY, async (d) => ({ d, rates: await fetchDay(d) }));
    const rows: { day: string; quote: string; rate: number }[] = [];
    for (const { d, rates } of fetched) {
      if (!rates) {
        failedAt.set(d, now.getTime());
        continue;
      }
      for (const [quote, rate] of Object.entries(rates)) {
        if (quote !== "USD") rows.push({ day: d, quote, rate });
      }
      // USD itself is always 1; a marker row keeps "fetched" distinct from "never asked".
      rows.push({ day: d, quote: "USD", rate: 1 });
    }
    if (rows.length > 0) {
      await db
        .insert(fxHistory)
        .values(rows)
        .onConflictDoUpdate({
          target: [fxHistory.day, fxHistory.quote],
          set: { rate: sql`excluded.rate` },
        });
    }
    for (const [d, r] of await read()) have.set(d, r);
  }

  for (const [d, r] of have) out.set(d, r);
  return out;
}
