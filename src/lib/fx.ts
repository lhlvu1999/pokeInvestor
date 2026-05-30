import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fxRates } from "@/db/schema";
import {
  convertMinor,
  isSupportedCurrency,
  type CurrencyCode,
} from "./currency";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const FX_ENDPOINT = "https://open.er-api.com/v6/latest";

/**
 * Fetches latest spot rates with `base` as the source currency.
 * Returns a map of `quote → rate` (i.e. `quote per 1 base`).
 */
async function fetchSpotRates(
  base: CurrencyCode,
): Promise<Record<string, number>> {
  const res = await fetch(`${FX_ENDPOINT}/${base}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`FX fetch failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    result?: string;
    rates?: Record<string, number>;
  };
  if (json.result !== "success" || !json.rates) {
    throw new Error("FX fetch returned an error payload");
  }
  return json.rates;
}

async function getCachedRate(
  base: CurrencyCode,
  quote: CurrencyCode,
): Promise<{ rate: number; fetchedAt: Date } | null> {
  const [row] = await db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.base, base), eq(fxRates.quote, quote)))
    .limit(1);
  return row ? { rate: row.rate, fetchedAt: row.fetchedAt } : null;
}

async function upsertRates(
  base: CurrencyCode,
  rates: Record<string, number>,
): Promise<void> {
  const fetchedAt = new Date();
  const rows = Object.entries(rates)
    .filter(([quote]) => isSupportedCurrency(quote))
    .map(([quote, rate]) => ({ base, quote, rate, fetchedAt }));
  if (rows.length === 0) return;
  await db
    .insert(fxRates)
    .values(rows)
    .onConflictDoUpdate({
      target: [fxRates.base, fxRates.quote],
      set: {
        rate: sql`excluded.rate`,
        fetchedAt,
      },
    });
}

/**
 * Get a "quote per 1 base" rate, using cache when fresh, fetching otherwise.
 * If the API is down and we have a stale cached rate, fall back to it.
 * Throws only if there is no rate available at all.
 */
export async function getRate(
  base: CurrencyCode,
  quote: CurrencyCode,
): Promise<{ rate: number; fetchedAt: Date; stale: boolean }> {
  if (base === quote) {
    return { rate: 1, fetchedAt: new Date(), stale: false };
  }

  const cached = await getCachedRate(base, quote);
  const fresh =
    cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS;
  if (cached && fresh) {
    return { rate: cached.rate, fetchedAt: cached.fetchedAt, stale: false };
  }

  try {
    const rates = await fetchSpotRates(base);
    await upsertRates(base, rates);
    const fetchedAt = new Date();
    const rate = rates[quote];
    if (rate == null) throw new Error(`No rate for ${quote} from ${base}`);
    return { rate, fetchedAt, stale: false };
  } catch (err) {
    if (cached) {
      return { rate: cached.rate, fetchedAt: cached.fetchedAt, stale: true };
    }
    throw err;
  }
}

export type Conversion = {
  amount: number;
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number;
  fetchedAt: Date;
  stale: boolean;
};

export async function convert(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
): Promise<Conversion> {
  const { rate, fetchedAt, stale } = await getRate(from, to);
  return {
    amount: convertMinor(amountMinor, from, to, rate),
    from,
    to,
    rate,
    fetchedAt,
    stale,
  };
}
