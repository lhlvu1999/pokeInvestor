/**
 * A market index: how the typical set (or sealed product) has moved, as one
 * line starting at 100.
 *
 * The index is chain-linked. Each day it multiplies in that day's typical
 * change, measured only over things priced on both that day and the day
 * before. A set whose card count jumped, or a product that first got a price
 * today, therefore cannot move the index by merely appearing; only price
 * moves count. Days with too few things to be representative are skipped
 * rather than guessed.
 *
 * The "typical" change per day is computed where the data lives (a trimmed
 * mean in SQL); this module links those daily changes together and measures
 * the result.
 */

import { changeOver, daysBetween, type Point } from "./set_history";

export type DailyChange = {
  /** The day the change lands on (YYYY-MM-DD). */
  day: string;
  /** The typical change from the previous day, as a fraction (0.01 = +1%). */
  change: number | null;
  /** How many things the typical change was measured over. */
  n: number;
};

export type IndexPoint = { day: string; value: number };

/** Fewest constituents for a day's change to count. */
export const MIN_CONSTITUENTS = 8;

/** Index level on the day before the first usable change. */
export const INDEX_BASE = 100;

const DAY_MS = 86_400_000;

/** The calendar day before a YYYY-MM-DD string. */
function dayBefore(day: string): string {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  return new Date(t - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Link daily changes into an index. Input need not be sorted. Days whose
 * change is missing, not finite, at or below −100%, or measured over fewer
 * than `minConstituents` things are left out. Returns [] if no day is usable.
 */
export function chainIndex(
  changes: ReadonlyArray<DailyChange>,
  minConstituents = MIN_CONSTITUENTS,
): IndexPoint[] {
  const usable = changes
    .filter(
      (c) =>
        c.change != null &&
        Number.isFinite(c.change) &&
        c.change > -1 &&
        c.n >= minConstituents,
    )
    .sort((a, b) => a.day.localeCompare(b.day));
  if (usable.length === 0) return [];

  const out: IndexPoint[] = [
    { day: dayBefore(usable[0].day), value: INDEX_BASE },
  ];
  let level = INDEX_BASE;
  for (const c of usable) {
    level *= 1 + (c.change as number);
    out.push({ day: c.day, value: level });
  }
  return out;
}

/**
 * Blend several groups' daily changes into one, weighting each group by how
 * many things it was measured over (geometric, like the changes themselves).
 *
 * This is used instead of pooling everything and trimming once: pooled
 * trimming cuts the tails of the more volatile groups harder, so the blend
 * would mostly describe the quiet ones and could even land outside the range
 * of its own parts. A weighted blend of the groups' own typical changes can't.
 * A day counts only for groups with a usable change; with none, it's null.
 */
export function blendChanges(
  groups: ReadonlyArray<ReadonlyArray<DailyChange>>,
): DailyChange[] {
  const byDay = new Map<string, { logSum: number; n: number }>();
  for (const group of groups) {
    for (const c of group) {
      if (c.change == null || !Number.isFinite(c.change) || c.change <= -1) {
        continue;
      }
      if (c.n <= 0) continue;
      const acc = byDay.get(c.day) ?? { logSum: 0, n: 0 };
      acc.logSum += c.n * Math.log1p(c.change);
      acc.n += c.n;
      byDay.set(c.day, acc);
    }
  }
  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { logSum, n }]) => ({
      day,
      change: Math.expm1(logSum / n),
      n,
    }));
}

/** Change of an index over a window, or null if it doesn't reach back that far. */
export function indexChange(
  series: ReadonlyArray<IndexPoint>,
  days: number,
): number | null {
  const points: Point[] = series.map((p) => ({
    day: p.day,
    // `changeOver` takes whole numbers; millionths of a point keeps the
    // rounding far below anything visible.
    cents: Math.round(p.value * 1e6),
  }));
  return changeOver(points, days);
}

/** The largest fall from a previous high, as a fraction (0.3 = −30%). */
export function maxDrawdown(series: ReadonlyArray<IndexPoint>): number {
  let peak = -Infinity;
  let worst = 0;
  for (const p of series) {
    if (p.value > peak) peak = p.value;
    worst = Math.max(worst, 1 - p.value / peak);
  }
  return worst;
}

/** How many days the series spans. */
export function spanDays(series: ReadonlyArray<IndexPoint>): number {
  if (series.length < 2) return 0;
  return daysBetween(series[0].day, series[series.length - 1].day);
}

/**
 * Restate several indexes so each is 100 on the same day, which makes their
 * lines comparable when they started at different times. The day used is the
 * latest first day among them (the earliest day they all exist). Each series
 * keeps only the points from that day on, so the lines start together.
 */
export function rebaseTogether(
  all: ReadonlyArray<ReadonlyArray<IndexPoint>>,
): { day: string; series: IndexPoint[][] } | null {
  const nonEmpty = all.filter((s) => s.length > 0);
  if (nonEmpty.length === 0) return null;
  const day = nonEmpty.map((s) => s[0].day).reduce((a, b) => (a > b ? a : b));

  const series = all.map((s) => {
    // The latest point on or before the common day is the base.
    let base: IndexPoint | null = null;
    for (const p of s) {
      if (p.day <= day) base = p;
      else break;
    }
    if (!base) return [];
    return s
      .filter((p) => p.day >= base.day)
      .map((p) => ({ day: p.day, value: (p.value / base.value) * 100 }));
  });
  return { day, series };
}
