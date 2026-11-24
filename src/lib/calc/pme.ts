/**
 * "What if the same money had gone into the index?"
 *
 * This is the standard way to judge a set of irregular cash flows against a
 * benchmark (a "public market equivalent"). Every buy is treated as buying
 * that much of the index on the day you made it, and every sale as selling
 * that much of it on the day you sold. What is left over is valued at today's
 * index level. Two things then come out:
 *
 *  - the yearly rate the index would have earned for exactly your cash flows,
 *    to set against your own rate (both money-weighted, so the timing of every
 *    purchase counts);
 *  - the money the index would have left you holding, to set against what you
 *    actually hold.
 *
 * It answers "how much of my result is me, and how much is the market?". The
 * index measures the typical product, so it is a yardstick for how the market
 * moved, not a strategy you could have bought.
 */

import {
  MIN_DAYS,
  FULL_YEAR_DAYS,
  xirr,
  type CashFlow,
  type ReturnEvent,
} from "./annualized";
import type { IndexPoint } from "./market_index";

const MS_PER_DAY = 86_400_000;

/** A newest index point older than this, in days, isn't "now". */
export const STALE_INDEX_DAYS = 7;

/** A buy or sale, with the index it is measured against. */
export type BenchEvent = ReturnEvent & {
  /** The benchmark for this event's position; null when there isn't one. */
  series: ReadonlyArray<IndexPoint> | null;
};

export type PmeUnavailable =
  | "no_activity"
  | "no_index"
  | "before_index"
  | "ambiguous";

export type PmeResult =
  | {
      status: "ok";
      days: number;
      extrapolated: boolean;
      /** Your yearly rate (fraction); null when no single rate fits. */
      yourRate: number | null;
      /** The index's yearly rate for the same flows; null when none fits. */
      indexRate: number | null;
      /** yourRate − indexRate, in fractions (0.1 = 10 points); null if either is. */
      excess: number | null;
      /** What you hold today (minor units). */
      yourValue: number;
      /** What the same money would be worth in the index (can be ≤ 0). */
      indexValue: number;
      /** yourValue − indexValue. */
      valueDiff: number;
    }
  | { status: "too_early"; days: number; daysToGo: number }
  | { status: "unavailable"; reason: PmeUnavailable };

/** The index level on a day (YYYY-MM-DD): the latest point on or before it. */
export function indexLevelOn(
  series: ReadonlyArray<IndexPoint>,
  day: string,
): number | null {
  let level: number | null = null;
  for (const p of series) {
    if (p.day <= day) level = p.value;
    else break;
  }
  return level;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function pmeCompare(
  events: ReadonlyArray<BenchEvent>,
  terminalValue: number,
  now: Date,
): PmeResult {
  const dated = events.filter((e) => e.amount > 0 || e.type === "sell");
  if (dated.length === 0) {
    return { status: "unavailable", reason: "no_activity" };
  }

  let firstAt = dated[0].at;
  for (const e of dated) if (e.at < firstAt) firstAt = e.at;
  const days = Math.max(0, Math.floor((now.getTime() - firstAt.getTime()) / MS_PER_DAY));
  if (days < MIN_DAYS) {
    return { status: "too_early", days, daysToGo: MIN_DAYS - days };
  }

  // Units of each event's index bought (+) or sold (−), valued at today's level.
  const today = dayOf(now);
  let indexValue = 0;
  for (const e of dated) {
    if (!e.series || e.series.length === 0) {
      return { status: "unavailable", reason: "no_index" };
    }
    const last = e.series[e.series.length - 1];
    const stale =
      (Date.parse(today) - Date.parse(last.day)) / MS_PER_DAY > STALE_INDEX_DAYS;
    if (stale) return { status: "unavailable", reason: "no_index" };
    const then = indexLevelOn(e.series, dayOf(e.at));
    if (then == null || !(then > 0)) {
      return { status: "unavailable", reason: "before_index" };
    }
    const units = e.amount / then;
    indexValue += (e.type === "buy" ? units : -units) * last.value;
  }

  const flows: CashFlow[] = dated.map((e) => ({
    at: e.at,
    amount: e.type === "buy" ? -e.amount : e.amount,
  }));
  const yours = xirr([...flows, { at: now, amount: terminalValue }]);
  const theirs =
    indexValue > 0 ? xirr([...flows, { at: now, amount: indexValue }]) : null;

  const yourRate = yours.ok ? yours.rate : null;
  const indexRate = theirs && theirs.ok ? theirs.rate : null;
  return {
    status: "ok",
    days,
    extrapolated: days < FULL_YEAR_DAYS,
    yourRate,
    indexRate,
    excess: yourRate != null && indexRate != null ? yourRate - indexRate : null,
    yourValue: terminalValue,
    indexValue,
    valueDiff: terminalValue - indexValue,
  };
}

export const PME_UNAVAILABLE_TEXT: Record<PmeUnavailable, string> = {
  no_activity: "No buys or sales yet.",
  no_index: "No recent index to compare with.",
  before_index: "Some of it was bought before the index begins.",
  ambiguous: "More than one yearly rate fits.",
};

/**
 * "22.3 points ahead" / "4.1 points behind" / "level": the gap between two
 * yearly rates, in percentage points. A rate is a fraction, so 0.223 is 22.3
 * points. Gaps beyond 1,000 points are arithmetic on a short, lucky stretch
 * and are capped in the words.
 */
export function excessText(excess: number): string {
  const points = excess * 100;
  if (Math.abs(points) < 0.05) return "level with the index";
  const n = Math.abs(points) > 1000 ? "more than 1,000" : Math.abs(points).toFixed(1);
  return `${n} points ${points > 0 ? "ahead" : "behind"}`;
}
