/**
 * The age at which earlier launches of a kind of product have typically been
 * at their lowest price.
 *
 * Measured from day 7 (past the launch rush) over the first year: the age
 * with the lowest median change, among ages with enough sets behind them.
 * Only counted as a "usual low" when that dip is real (at least 5% below the
 * day-7 price); otherwise the kind has no consistent dip and there is
 * nothing to point at.
 *
 * It describes what earlier sets did. It is not advice to buy then.
 */

import {
  ageCurve,
  type AgedProduct,
  type CurvePoint,
} from "./age_curve";
import type { SealedType } from "./sealed_type";

/** The age prices are measured from. */
export const LOW_BASE_AGE = 7;
/** How far into a product's life to look for its low. */
export const LOW_MAX_AGE = 365;
/** Fewest sets behind an age for it to count. */
export const LOW_MIN_SETS = 8;
/** The dip must be at least this far below the base price (a fraction). */
export const LOW_MIN_DIP = 0.05;
/** Days either side of the usual low that count as "at the low". */
export const LOW_WINDOW_DAYS = 14;

export type UsualLow = Pick<CurvePoint, "age" | "median" | "p25" | "p75" | "sets">;

/** The usual low on a curve measured from `LOW_BASE_AGE`, or null. */
export function usualLowOf(curve: ReadonlyArray<CurvePoint>): UsualLow | null {
  let best: CurvePoint | null = null;
  for (const p of curve) {
    if (p.age <= LOW_BASE_AGE || p.age > LOW_MAX_AGE) continue;
    if (p.sets < LOW_MIN_SETS) continue;
    // Strictly lower wins; ties keep the earlier age.
    if (!best || p.median < best.median) best = p;
  }
  if (!best || best.median > -LOW_MIN_DIP) return null;
  return {
    age: best.age,
    median: best.median,
    p25: best.p25,
    p75: best.p75,
    sets: best.sets,
  };
}

/** The usual low for one kind of product and language. */
export function usualLow(
  cohort: ReadonlyArray<AgedProduct>,
  kind: SealedType,
  language: "en" | "ja",
): UsualLow | null {
  return usualLowOf(
    ageCurve(cohort, {
      type: kind,
      baseAge: LOW_BASE_AGE,
      language,
      minSets: LOW_MIN_SETS,
    }),
  );
}

/** True when a product's age is within the window around the usual low. */
export function atUsualLow(ageDays: number, low: UsualLow): boolean {
  return Math.abs(ageDays - low.age) <= LOW_WINDOW_DAYS;
}
