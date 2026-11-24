/**
 * How one set is tracking against earlier sets at the same age: its chase
 * (top 20), top 10 and whole-set value, and what earlier sets' chase did next.
 *
 * Built from the set's own daily history. Like the card age curves, a
 * comparison only counts when the number of priced cards is about the same on
 * both days (within 10%), so a card gaining its first price can't read as the
 * market moving. The set's own set is left out of the cohort it is compared
 * with.
 */

import {
  nearestAge,
  pointAt,
  typicalAt,
  type Typical,
} from "./age_curve";
import {
  comparableCoverage,
  setCurve,
  CARD_METRICS,
  type AgedSet,
  type CardMetric,
} from "./card_curve";
import { phaseFor, type Phase, type Position } from "./lifecycle";
import { daysBetween } from "./set_history";

/** One day of a set's history. Values are US cents. */
export type SetDay = {
  day: string;
  priced: number;
  top20: number;
  top10: number;
  total: number;
};

/** Starting ages to measure from, in order of preference. */
const BASE_PREFERENCE = [14, 7, 0, 30] as const;

/** Look back at most this many days from a target day for the set's figure. */
const LOOKBACK_DAYS = 3;

/** How far ahead to look, in days (snapped to the age grid). */
const HORIZONS = [90, 180] as const;

export type CardTracking = {
  metric: CardMetric;
  /** The age (days since release) it is measured from. */
  baseAge: number;
  /** This set's change since then (0.1 = +10%). */
  own: number;
  /** What earlier sets did from that age to this one. */
  typical: Typical | null;
  position: Position | null;
};

export type SetForward = Typical & {
  fromAge: number;
  toAge: number;
  shareUp: number;
};

export type SetTracking = {
  /** Days since release at the newest figure; null when unknown. */
  ageDays: number | null;
  phase: Phase | null;
  cards: CardTracking[];
  /** What earlier sets' top 20 did over the stretch after this age. */
  forward: SetForward[];
};

/** The latest day on or before `day`, within the look-back window. */
export function dayOnOrBefore(
  days: ReadonlyArray<SetDay>,
  day: string,
): SetDay | null {
  let found: SetDay | null = null;
  for (const d of days) {
    if (d.day <= day) found = d;
    else break;
  }
  return found && daysBetween(found.day, day) <= LOOKBACK_DAYS ? found : null;
}

export const addDays = (day: string, n: number): string =>
  new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

export function trackSet(
  input: {
    groupId: number;
    language: "en" | "ja";
    /** YYYY-MM-DD; null when unknown or not trustworthy. */
    releasedOn: string | null;
    /** Oldest first. */
    days: ReadonlyArray<SetDay>;
  },
  cohort: ReadonlyArray<AgedSet>,
): SetTracking {
  const { groupId, language, releasedOn, days } = input;
  const latest = days.length > 0 ? days[days.length - 1] : null;
  const empty: SetTracking = {
    ageDays: null,
    phase: null,
    cards: [],
    forward: [],
  };
  if (!releasedOn || !latest) return empty;

  const ageDays = daysBetween(releasedOn, latest.day);
  const base: SetTracking = {
    ...empty,
    ageDays,
    phase: phaseFor(ageDays),
  };
  if (ageDays < 0) return base;

  const others = cohort.filter((s) => s.groupId !== groupId);

  const cards: CardTracking[] = [];
  for (const metric of CARD_METRICS) {
    const nowV = latest[metric];
    if (!(latest.priced > 0) || !(nowV > 0)) continue;
    for (const baseAge of BASE_PREFERENCE) {
      if (ageDays <= baseAge) continue;
      const row = dayOnOrBefore(days, addDays(releasedOn, baseAge));
      if (!row || !(row.priced > 0) || !(row[metric] > 0)) continue;
      if (!comparableCoverage(row.priced, latest.priced)) continue;

      const own = nowV / row[metric] - 1;
      const typical = typicalAt(
        setCurve(others, { metric, baseAge, language }),
        ageDays,
      );
      const position: Position | null = typical
        ? own < typical.p25
          ? "below"
          : own > typical.p75
            ? "above"
            : "within"
        : null;
      cards.push({ metric, baseAge, own, typical, position });
      break;
    }
  }

  const forward: SetForward[] = [];
  const fromAge = nearestAge(Math.max(0, ageDays));
  const curve = setCurve(others, { metric: "top20", baseAge: fromAge, language });
  const seen = new Set<number>();
  for (const h of HORIZONS) {
    const toAge = nearestAge(fromAge + h);
    if (toAge <= fromAge || seen.has(toAge)) continue;
    const p = pointAt(curve, toAge);
    if (!p) continue;
    seen.add(toAge);
    forward.push({
      fromAge,
      toAge,
      median: p.median,
      p25: p.p25,
      p75: p.p75,
      sets: p.sets,
      shareUp: p.shareUp,
    });
  }

  return { ...base, cards, forward };
}
