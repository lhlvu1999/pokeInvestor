/**
 * How sealed products' prices change with the age of their set.
 *
 * For every set released since the history began we know what each product
 * cost at launch and at later ages. Expressing each as a multiple of its price
 * at a base age lines sets up on their own release day, so the median across
 * sets shows the typical path (and the spread shows how much it varies).
 *
 * Unit of comparison is one (set, kind of product): a set with two Elite
 * Trainer Boxes counts once, at the median of its two, so a set can't weigh
 * double just because it had a second SKU.
 */

import type { SealedType } from "./sealed_type";

/**
 * Ages (days since release) a price is looked up at. The first six are
 * before release, for pre-order prices (negative ages count down to launch).
 * Past launches rarely have a price earlier than about 60 days out.
 */
export const AGES: ReadonlyArray<number> = [
  -60, -45, -30, -21, -14, -7, 0, 7, 14, 21, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300,
  365, 450, 540, 630, 730, 900,
];

/** Base ages a curve can be measured against. */
export const BASE_AGES: ReadonlyArray<number> = [0, 7, 30];

/** Fewest sets behind a point for it to be shown. */
export const MIN_SETS = 5;

export type AgedProduct = {
  groupId: number;
  language: "en" | "ja";
  type: SealedType;
  /** Price in US cents at each of `AGES`; null when there isn't one. */
  prices: ReadonlyArray<number | null>;
};

export type CurvePoint = {
  age: number;
  /** Sets behind this point. */
  sets: number;
  /** Typical change since the base age, as a fraction (0.2 = +20%). */
  median: number;
  /** A quarter of sets did worse than this. */
  p25: number;
  /** A quarter of sets did better than this. */
  p75: number;
  /** Share of sets priced above where they started (0–1). */
  shareUp: number;
};

/** The q-th quantile (0–1) of numbers, by linear interpolation. */
export function quantile(values: ReadonlyArray<number>, q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * The median curve for one kind of product (and optionally one language),
 * measured against the price at `baseAge`. Only ages from the base onward are
 * returned, and only those with at least `minSets` sets behind them. A set
 * needs a price at both the base age and the age in question to count.
 */
export function ageCurve(
  products: ReadonlyArray<AgedProduct>,
  options: {
    type: SealedType;
    baseAge: number;
    language?: "en" | "ja";
    minSets?: number;
  },
): CurvePoint[] {
  const { type, baseAge, language, minSets = MIN_SETS } = options;
  const baseIdx = AGES.indexOf(baseAge);
  if (baseIdx < 0) return [];

  const mine = products.filter(
    (p) => p.type === type && (!language || p.language === language),
  );
  const out: CurvePoint[] = [];

  for (let i = baseIdx; i < AGES.length; i++) {
    // One ratio per product, then one value per set (median of its products).
    const bySet = new Map<number, number[]>();
    for (const p of mine) {
      const base = p.prices[baseIdx];
      const then = p.prices[i];
      // `!(x > 0)` also rejects NaN, which `x <= 0` lets through.
      if (base == null || !(base > 0) || then == null || !(then > 0)) continue;
      const list = bySet.get(p.groupId) ?? [];
      list.push(then / base - 1);
      bySet.set(p.groupId, list);
    }
    const perSet = [...bySet.values()].map((r) => quantile(r, 0.5));
    if (perSet.length < minSets) continue;
    out.push({
      age: AGES[i],
      sets: perSet.length,
      median: quantile(perSet, 0.5),
      p25: quantile(perSet, 0.25),
      p75: quantile(perSet, 0.75),
      shareUp: perSet.filter((r) => r > 0).length / perSet.length,
    });
  }
  return out;
}

/** The point at exactly this age, or null if too few sets reached it. */
export function pointAt(
  curve: ReadonlyArray<CurvePoint>,
  age: number,
): CurvePoint | null {
  return curve.find((p) => p.age === age) ?? null;
}

export type Typical = {
  median: number;
  p25: number;
  p75: number;
  /** Fewest sets behind the points it is drawn from. */
  sets: number;
};

/**
 * The typical change at an exact age, which usually falls between two of the
 * ages prices are looked up at. Linear between the two neighbouring points.
 * Null when the age is outside the curve, or the neighbours aren't adjacent
 * ages (a gap in the middle means too few sets there; bridging it would be a
 * guess).
 */
export function typicalAt(
  curve: ReadonlyArray<CurvePoint>,
  age: number,
): Typical | null {
  const exact = curve.find((p) => p.age === age);
  if (exact) {
    return {
      median: exact.median,
      p25: exact.p25,
      p75: exact.p75,
      sets: exact.sets,
    };
  }
  for (let i = 0; i + 1 < curve.length; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (age <= a.age || age >= b.age) continue;
    if (AGES.indexOf(b.age) !== AGES.indexOf(a.age) + 1) return null;
    const t = (age - a.age) / (b.age - a.age);
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return {
      median: lerp(a.median, b.median),
      p25: lerp(a.p25, b.p25),
      p75: lerp(a.p75, b.p75),
      sets: Math.min(a.sets, b.sets),
    };
  }
  return null;
}

/** The grid age closest to `age` (ties go to the younger one). */
export function nearestAge(age: number): number {
  let best = AGES[0];
  for (const a of AGES) {
    if (Math.abs(a - age) < Math.abs(best - age)) best = a;
  }
  return best;
}
