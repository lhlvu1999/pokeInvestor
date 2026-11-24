/**
 * The Compare sets page keeps its choices in the URL. Anything unrecognised
 * falls back to a default rather than erroring.
 */

import {
  CARD_BASE_AGES,
  CARD_METRICS,
  type CardMetric,
} from "./card_curve";

/** Most sets that can be compared at once (the chart has this many colours). */
export const MAX_COMPARE = 5;
const MAX_ID = 2_147_483_647;

export type CompareParams = {
  /** Set group ids, in the order given. */
  sets: number[];
  /** What the sets are searched for by, when adding one. */
  q: string;
  card: CardMetric;
  base: number;
  /** Show the typical range of earlier sets behind the lines. */
  band: boolean;
};

export const DEFAULT_COMPARE: CompareParams = {
  sets: [],
  q: "",
  card: "top20",
  base: 14,
  band: true,
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseSetIds(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!/^\d{1,10}$/.test(t)) continue;
    const n = Number(t);
    if (n < 1 || n > MAX_ID || out.includes(n)) continue;
    out.push(n);
    if (out.length === MAX_COMPARE) break;
  }
  return out;
}

export function parseCompareParams(raw: Raw): CompareParams {
  const card = one(raw.card);
  const base = one(raw.base);
  const baseNum = base !== undefined && /^\d+$/.test(base) ? Number(base) : NaN;
  return {
    sets: parseSetIds(one(raw.sets)),
    q: (one(raw.q) ?? "").trim().slice(0, 60),
    card: (CARD_METRICS as ReadonlyArray<string>).includes(card ?? "")
      ? (card as CardMetric)
      : DEFAULT_COMPARE.card,
    base: CARD_BASE_AGES.includes(baseNum) ? baseNum : DEFAULT_COMPARE.base,
    band: one(raw.band) !== "off",
  };
}

/** A link to the page with some choices changed, leaving the rest alone. */
export function compareHref(
  current: CompareParams,
  change: Partial<CompareParams>,
): string {
  const next = { ...current, ...change };
  const q = new URLSearchParams();
  if (next.sets.length > 0) q.set("sets", next.sets.join(","));
  if (next.q) q.set("q", next.q);
  if (next.card !== DEFAULT_COMPARE.card) q.set("card", next.card);
  if (next.base !== DEFAULT_COMPARE.base) q.set("base", String(next.base));
  if (!next.band) q.set("band", "off");
  const s = q.toString();
  return s ? `/catalog/compare?${s}` : "/catalog/compare";
}
