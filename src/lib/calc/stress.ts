/**
 * Replaying today's stock through history.
 *
 * Blend the indexes of the kinds you hold, weighted by how much of your stock
 * each is, into one line; then find the worst stretches of 30 and 90 days on
 * it. The answer is "had you held this mix throughout, the worst 30 days
 * would have cost X". It looks backward at what the market actually did. It
 * is not a forecast, and a worse stretch than any seen could still happen.
 */

import { daysBetween } from "./set_history";
import type { IndexPoint } from "./market_index";

export type MixComponent = {
  /** How much of the stock this is (any positive scale). */
  weight: number;
  series: ReadonlyArray<IndexPoint>;
};

/**
 * One index for the whole mix, 100 on the first day all components share.
 * Only days present in every component are used, so the line starts when the
 * youngest component's history does. Empty when there is nothing to blend.
 */
export function mixIndex(components: ReadonlyArray<MixComponent>): IndexPoint[] {
  const parts = components.filter((c) => c.weight > 0 && c.series.length > 0);
  if (parts.length === 0) return [];

  let days = new Set(parts[0].series.map((p) => p.day));
  for (const c of parts.slice(1)) {
    const has = new Set(c.series.map((p) => p.day));
    days = new Set([...days].filter((d) => has.has(d)));
  }
  const ordered = [...days].sort();
  if (ordered.length < 2) return [];

  const total = parts.reduce((a, c) => a + c.weight, 0);
  const lookups = parts.map((c) => ({
    w: c.weight / total,
    byDay: new Map(c.series.map((p) => [p.day, p.value])),
  }));
  const first = ordered[0];
  return ordered.map((day) => ({
    day,
    value:
      100 *
      lookups.reduce(
        (a, l) => a + l.w * (l.byDay.get(day)! / l.byDay.get(first)!),
        0,
      ),
  }));
}

export type Window = {
  /** The change over the window (−0.2 = −20%). */
  change: number;
  fromDay: string;
  toDay: string;
};

/**
 * The worst change over any stretch of `windowDays` days: from the latest
 * point at least that many days before each point to that point. Null when
 * the series is shorter than the window.
 */
export function worstWindow(
  series: ReadonlyArray<IndexPoint>,
  windowDays: number,
): Window | null {
  let worst: Window | null = null;
  let i = 0;
  for (let j = 0; j < series.length; j++) {
    // Advance i to the latest point at least `windowDays` before j.
    while (
      i + 1 < j &&
      daysBetween(series[i + 1].day, series[j].day) >= windowDays
    ) {
      i++;
    }
    if (daysBetween(series[i].day, series[j].day) < windowDays) continue;
    const change = series[j].value / series[i].value - 1;
    if (!worst || change < worst.change) {
      worst = { change, fromDay: series[i].day, toDay: series[j].day };
    }
  }
  return worst;
}
