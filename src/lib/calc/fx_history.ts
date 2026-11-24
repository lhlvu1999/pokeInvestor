/**
 * Exchange rates as they were on a given day, for reports about the past.
 *
 * A sale made in dollars three months ago brought in what a dollar was worth
 * THEN, and the box it sold cost what a dollar was worth the day it was bought.
 * Converting both at today's rate would put the exchange-rate move into the
 * profit twice, so a report of past sales converts each money amount at the
 * rate of its own day. (Valuing what you hold now is different: that uses
 * today's rate, everywhere else in the app.)
 *
 * Rates are stored as "units of that currency per 1 USD", one set per day,
 * and any pair is worked out through the dollar.
 */

import { convertMinor, isSupportedCurrency } from "../currency";

export type DayRates = Record<string, number>;

/** How far back to look for a day's rates when that exact day has none. */
export const MAX_FALLBACK_DAYS = 7;

const DAY = 86_400_000;

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

const addDays = (day: string, n: number): string =>
  dayKey(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));

/** Where to read a day's rates: the CDN, then its mirror. No key needed. */
export function rateUrls(day: string): string[] {
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.json`,
    `https://${day}.currency-api.pages.dev/v1/currencies/usd.json`,
  ];
}

/**
 * Pull the supported currencies out of a downloaded file, or null if it is not
 * what we expect. Only sane, positive rates are kept.
 */
export function parseRates(payload: unknown, day: string): DayRates | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as { date?: unknown; usd?: unknown };
  if (p.date !== day) return null;
  if (typeof p.usd !== "object" || p.usd === null) return null;
  const out: DayRates = { USD: 1 };
  for (const [code, rate] of Object.entries(p.usd as Record<string, unknown>)) {
    const up = code.toUpperCase();
    if (up === "USD") continue;
    if (isSupportedCurrency(up) && typeof rate === "number" && rate > 0 && Number.isFinite(rate)) {
      out[up] = rate;
    }
  }
  return Object.keys(out).length > 1 ? out : null;
}

/**
 * The rates to use for `day`: that day's, or the closest earlier day within a
 * week (rates are not published for every day). Null when there is nothing
 * recent enough, so the caller can say so instead of guessing.
 */
export function ratesFor(
  day: string,
  byDay: ReadonlyMap<string, DayRates>,
): { rates: DayRates; usedDay: string } | null {
  for (let back = 0; back <= MAX_FALLBACK_DAYS; back++) {
    const d = back === 0 ? day : addDays(day, -back);
    const rates = byDay.get(d);
    if (rates) return { rates, usedDay: d };
  }
  return null;
}

/** `to` per 1 `from`, through the dollar; null if either currency has no rate. */
export function crossRate(from: string, to: string, usdTo: DayRates): number | null {
  if (from === to) return 1;
  const a = from === "USD" ? 1 : usdTo[from];
  const b = to === "USD" ? 1 : usdTo[to];
  if (!a || !b) return null;
  return b / a;
}

/** `minor` units of `from`, in `to`, at that day's rates; null if not possible. */
export function convertOn(
  minor: number,
  from: string,
  to: string,
  day: string,
  byDay: ReadonlyMap<string, DayRates>,
): number | null {
  if (from === to) return minor;
  const found = ratesFor(day, byDay);
  if (!found) return null;
  const rate = crossRate(from, to, found.rates);
  return rate == null ? null : convertMinor(minor, from, to, rate);
}

export type ForeignSale = {
  soldOn: Date;
  currency: string;
  proceeds: number;
  costLots: { buyDate: Date; cost: number }[];
};

export type ConvertedSale = {
  proceeds: number;
  cost: number;
  realized: number;
  /** True when any part had to use today's rate because no day's rate was found. */
  approx: boolean;
};

/**
 * One sale in the display currency: proceeds at the sale day's rate, each part
 * of the cost at its purchase day's rate. A part with no usable rate falls back
 * to `today` (the current rate) and the result is marked approximate; if even
 * that is missing there is no answer.
 */
export function convertSale(
  s: ForeignSale,
  display: string,
  byDay: ReadonlyMap<string, DayRates>,
  today: ((minor: number, from: string) => number | null) | null,
): ConvertedSale | null {
  let approx = false;
  const part = (minor: number, day: string): number | null => {
    const v = convertOn(minor, s.currency, display, day, byDay);
    if (v != null) return v;
    approx = true;
    return today ? today(minor, s.currency) : null;
  };
  const proceeds = part(s.proceeds, dayKey(s.soldOn));
  if (proceeds == null) return null;
  let cost = 0;
  for (const l of s.costLots) {
    const c = part(l.cost, dayKey(l.buyDate));
    if (c == null) return null;
    cost += c;
  }
  return { proceeds, cost, realized: proceeds - cost, approx };
}

/** Every day whose rates a set of foreign sales needs: sale days and purchase days. */
export function daysNeeded(sales: readonly ForeignSale[]): string[] {
  const days = new Set<string>();
  for (const s of sales) {
    days.add(dayKey(s.soldOn));
    for (const l of s.costLots) days.add(dayKey(l.buyDate));
  }
  return [...days].sort();
}
