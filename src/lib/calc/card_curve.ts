/**
 * How card values change with the age of their set: the twenty most valuable
 * cards (the chase), the top ten, or the whole set (one of each card).
 *
 * The catch with cards is coverage. A set's cards don't all have a price on
 * day one (Japanese sets are barely priced at release; English ones mostly
 * are), and a set's value grows when cards gain a price, not only when prices
 * move. Comparing an early value with a later one would then read a card
 * getting its first price as the market rising.
 *
 * So a set only counts for a pair of ages when its number of priced cards is
 * about the same on both days (within 10%). Anything else is left out of that
 * point rather than guessed at. This is also why Japanese sets only show up
 * once measured from about two weeks after release.
 */

import { AGES, quantile, type CurvePoint } from "./age_curve";

export type CardMetric = "top20" | "top10" | "total";

export const CARD_METRICS: ReadonlyArray<CardMetric> = [
  "top20",
  "top10",
  "total",
];

export const CARD_METRIC_LABELS: Record<CardMetric, string> = {
  top20: "Top 20 cards",
  top10: "Top 10 cards",
  total: "Whole set",
};

/** Base ages a card curve can be measured from. */
export const CARD_BASE_AGES: ReadonlyArray<number> = [0, 7, 14, 30];

/** The least overlap in priced cards between two ages (smaller ÷ larger). */
export const MIN_COVERAGE = 0.9;

/** Fewest sets behind a point for it to be shown. */
export const MIN_SETS = 5;

export type AgedSet = {
  groupId: number;
  language: "en" | "ja";
  /** Priced cards at each of `AGES`; null where the set has no figure. */
  priced: ReadonlyArray<number | null>;
  /** US cents at each of `AGES`. */
  top20: ReadonlyArray<number | null>;
  top10: ReadonlyArray<number | null>;
  total: ReadonlyArray<number | null>;
};

const usable = (n: number | null | undefined): n is number =>
  n != null && Number.isFinite(n) && n > 0;

/** True when two priced-card counts are close enough to compare values. */
export function comparableCoverage(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false;
  return Math.min(a, b) / Math.max(a, b) >= MIN_COVERAGE;
}

/**
 * The median curve for one metric (optionally one language), measured from
 * `baseAge`. For each later age, only sets whose priced-card count at that
 * age is within 10% of the count at the base age take part.
 */
export function setCurve(
  sets: ReadonlyArray<AgedSet>,
  options: {
    metric: CardMetric;
    baseAge: number;
    language?: "en" | "ja";
    minSets?: number;
  },
): CurvePoint[] {
  const { metric, baseAge, language, minSets = MIN_SETS } = options;
  const baseIdx = AGES.indexOf(baseAge);
  if (baseIdx < 0) return [];
  const mine = sets.filter((s) => !language || s.language === language);

  const out: CurvePoint[] = [];
  for (let i = baseIdx; i < AGES.length; i++) {
    const ratios: number[] = [];
    for (const s of mine) {
      const pBase = s.priced[baseIdx];
      const pThen = s.priced[i];
      const vBase = s[metric][baseIdx];
      const vThen = s[metric][i];
      if (!usable(pBase) || !usable(pThen)) continue;
      if (!usable(vBase) || !usable(vThen)) continue;
      if (!comparableCoverage(pBase, pThen)) continue;
      ratios.push(vThen / vBase - 1);
    }
    if (ratios.length < minSets) continue;
    out.push({
      age: AGES[i],
      sets: ratios.length,
      median: quantile(ratios, 0.5),
      p25: quantile(ratios, 0.25),
      p75: quantile(ratios, 0.75),
      shareUp: ratios.filter((r) => r > 0).length / ratios.length,
    });
  }
  return out;
}
