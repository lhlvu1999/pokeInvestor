/**
 * The Set insights page keeps its choices in the URL (so a view can be
 * shared or bookmarked, and the page needs no client JavaScript). Anything
 * unrecognised falls back to the default rather than erroring.
 */

import { BASE_AGES } from "./age_curve";
import { CARD_BASE_AGES, CARD_METRICS, type CardMetric } from "./card_curve";
import { SEALED_TYPES, type SealedType } from "./sealed_type";

export const INDEX_METRIC_VALUES = [
  "sealed_all",
  "box",
  "etb",
  "bundle",
  "pack",
  "set_total",
  "set_top20",
] as const;
export type IndexMetric = (typeof INDEX_METRIC_VALUES)[number];

export type InsightParams = {
  metric: IndexMetric;
  kind: SealedType;
  base: number;
  /** Card curves: which value, and the age they are measured from. */
  card: CardMetric;
  cbase: number;
};

export const DEFAULT_INSIGHT_PARAMS: InsightParams = {
  metric: "sealed_all",
  kind: "box",
  base: 0,
  card: "top20",
  cbase: 14,
};

type Raw = Record<string, string | string[] | undefined>;

/** The first value when a parameter is repeated. */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseInsightParams(raw: Raw): InsightParams {
  const metric = one(raw.metric);
  const kind = one(raw.kind);
  const base = one(raw.base);
  const baseNum = base !== undefined && /^\d+$/.test(base) ? Number(base) : NaN;
  const card = one(raw.card);
  const cbase = one(raw.cbase);
  const cbaseNum =
    cbase !== undefined && /^\d+$/.test(cbase) ? Number(cbase) : NaN;
  return {
    metric: (INDEX_METRIC_VALUES as ReadonlyArray<string>).includes(
      metric ?? "",
    )
      ? (metric as IndexMetric)
      : DEFAULT_INSIGHT_PARAMS.metric,
    kind: (SEALED_TYPES as ReadonlyArray<string>).includes(kind ?? "")
      ? (kind as SealedType)
      : DEFAULT_INSIGHT_PARAMS.kind,
    base: BASE_AGES.includes(baseNum) ? baseNum : DEFAULT_INSIGHT_PARAMS.base,
    card: (CARD_METRICS as ReadonlyArray<string>).includes(card ?? "")
      ? (card as CardMetric)
      : DEFAULT_INSIGHT_PARAMS.card,
    cbase: CARD_BASE_AGES.includes(cbaseNum)
      ? cbaseNum
      : DEFAULT_INSIGHT_PARAMS.cbase,
  };
}

/** A link to this page with some choices changed, leaving the rest as they are. */
export function insightHref(
  current: InsightParams,
  change: Partial<InsightParams>,
): string {
  const next = { ...current, ...change };
  const q = new URLSearchParams();
  if (next.metric !== DEFAULT_INSIGHT_PARAMS.metric) q.set("metric", next.metric);
  if (next.kind !== DEFAULT_INSIGHT_PARAMS.kind) q.set("kind", next.kind);
  if (next.base !== DEFAULT_INSIGHT_PARAMS.base) {
    q.set("base", String(next.base));
  }
  if (next.card !== DEFAULT_INSIGHT_PARAMS.card) q.set("card", next.card);
  if (next.cbase !== DEFAULT_INSIGHT_PARAMS.cbase) {
    q.set("cbase", String(next.cbase));
  }
  const s = q.toString();
  return s ? `/catalog/insights?${s}` : "/catalog/insights";
}
