/**
 * One set's value path by age: how its top 20, top 10 or whole-set value has
 * changed since a starting age, for each day since.
 *
 * Like the other card comparisons, a day only counts when about as many cards
 * were priced as on the starting day (within 10%), so a card gaining its first
 * price can't read as the market moving. Days that fail are simply not drawn.
 */

import { comparableCoverage, type CardMetric } from "./card_curve";
import { addDays, dayOnOrBefore, type SetDay } from "./set_tracking";
import { daysBetween } from "./set_history";

export type PathPoint = {
  /** Days since release. */
  age: number;
  /** Change since the starting age (0.1 = +10%). */
  change: number;
};

/**
 * The path from `baseAge` onward, oldest first. Empty when the set has no
 * usable figure at the starting age (its history doesn't reach back to it, or
 * nothing was priced then).
 */
export function setPath(
  days: ReadonlyArray<SetDay>,
  releasedOn: string,
  metric: CardMetric,
  baseAge: number,
): PathPoint[] {
  const base = dayOnOrBefore(days, addDays(releasedOn, baseAge));
  if (!base || !(base.priced > 0) || !(base[metric] > 0)) return [];

  const out: PathPoint[] = [];
  for (const d of days) {
    const age = daysBetween(releasedOn, d.day);
    if (age < baseAge) continue;
    if (!(d.priced > 0) || !(d[metric] > 0)) continue;
    if (!comparableCoverage(base.priced, d.priced)) continue;
    out.push({ age, change: d[metric] / base[metric] - 1 });
  }
  return out;
}

/** The point at (or the latest before) an age, or null if none yet. */
export function pathAt(
  path: ReadonlyArray<PathPoint>,
  age: number,
): PathPoint | null {
  let found: PathPoint | null = null;
  for (const p of path) {
    if (p.age <= age) found = p;
    else break;
  }
  return found;
}
