/**
 * Where a sealed product sits in its life, and how that compares with what
 * earlier sets did.
 *
 * Three things are worked out from the catalogue's price history:
 *  - its age (days since its set came out) and a plain age band;
 *  - how its price has moved since a base age (day 7, else release, else day
 *    30), against what the same kind of product typically did by that age;
 *  - what earlier sets' products typically did over the following months,
 *    starting from the age this one is at.
 *
 * Everything is descriptive: it reports past behaviour of past sets. The
 * product's own set is left out of the comparison so it can't be compared
 * with itself.
 */

import {
  AGES,
  ageCurve,
  nearestAge,
  pointAt,
  typicalAt,
  type AgedProduct,
  type Typical,
} from "./age_curve";
import type { SealedType } from "./sealed_type";
import { daysBetween } from "./set_history";

export type Phase =
  "upcoming" | "launch" | "early" | "first_year" | "established";

export const PHASE_LABELS: Record<Phase, string> = {
  upcoming: "Not out yet",
  launch: "Launch window",
  early: "First months",
  first_year: "First year",
  established: "Established",
};

/** Plain age bands; they name how old a product is, not what it will do. */
export function phaseFor(ageDays: number): Phase {
  if (ageDays < 0) return "upcoming";
  if (ageDays < 30) return "launch";
  if (ageDays < 180) return "early";
  if (ageDays < 365) return "first_year";
  return "established";
}

/** Base ages to measure from, in order of preference. */
const BASE_PREFERENCE = [7, 0, 30] as const;

/** Comparisons resting on fewer sets than this are called out as thin. */
export const THIN_SETS = 8;

/** How far ahead to look, in days (snapped to the age grid). */
const HORIZONS = [90, 180] as const;

export type LifecycleInput = {
  groupId: number;
  language: "en" | "ja";
  /** Null when this isn't a kind of product the curves cover. */
  kind: SealedType | null;
  /** YYYY-MM-DD; null when unknown or not trustworthy. */
  releasedOn: string | null;
  /** Newest market price, in US cents. */
  latest: { day: string; cents: number } | null;
  /** Price at each of `AGES` (US cents); null where there isn't one. */
  prices: ReadonlyArray<number | null>;
};

export type Forward = Typical & {
  /** The ages the movement is measured between (snapped to the age grid). */
  fromAge: number;
  toAge: number;
  /** Share of earlier sets whose price rose over that stretch (0–1). */
  shareUp: number;
};

export type Position = "below" | "within" | "above";

export type Lifecycle = {
  kind: SealedType | null;
  language: "en" | "ja";
  /** Days since release at the newest price; negative before release. */
  ageDays: number | null;
  phase: Phase | null;
  /** This product's own move since `baseAge`. */
  own: {
    baseAge: number;
    baseCents: number;
    latestCents: number;
    change: number;
  } | null;
  /** What the same kind typically did from that base age to this age. */
  typical: Typical | null;
  /** Where `own` falls against the middle half of earlier sets. */
  position: Position | null;
  /** What earlier sets did over the stretch after this age. */
  forward: Forward[];
};

export function buildLifecycle(
  input: LifecycleInput,
  cohort: ReadonlyArray<AgedProduct>,
): Lifecycle {
  const { kind, language, releasedOn, latest } = input;
  const ageDays =
    releasedOn && latest ? daysBetween(releasedOn, latest.day) : null;

  const empty: Lifecycle = {
    kind,
    language,
    ageDays,
    phase: ageDays == null ? null : phaseFor(ageDays),
    own: null,
    typical: null,
    position: null,
    forward: [],
  };
  if (ageDays == null || !latest) return empty;

  // Earlier sets only: never compare a set with itself.
  const others = cohort.filter((p) => p.groupId !== input.groupId);

  // This product's own move since the first usable base age.
  let own: Lifecycle["own"] = null;
  for (const baseAge of BASE_PREFERENCE) {
    if (ageDays <= baseAge) continue;
    const idx = AGES.indexOf(baseAge);
    const base = input.prices[idx];
    if (base != null && base > 0) {
      own = {
        baseAge,
        baseCents: base,
        latestCents: latest.cents,
        change: latest.cents / base - 1,
      };
      break;
    }
  }

  let typical: Typical | null = null;
  let position: Position | null = null;
  if (own && kind) {
    const curve = ageCurve(others, {
      type: kind,
      baseAge: own.baseAge,
      language,
    });
    typical = typicalAt(curve, ageDays);
    if (typical) {
      position =
        own.change < typical.p25
          ? "below"
          : own.change > typical.p75
            ? "above"
            : "within";
    }
  }

  const forward: Forward[] = [];
  if (kind) {
    // Before release this snaps to a pre-order age (down to 30 days out).
    const fromAge = nearestAge(Math.max(AGES[0], ageDays));
    const curve = ageCurve(others, { type: kind, baseAge: fromAge, language });
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
  }

  return { ...empty, own, typical, position, forward };
}

/** "3 weeks old", "4 months old", "1.5 years old"; "out in 5 days" before release. */
export function ageLabel(ageDays: number): string {
  if (ageDays < 0) {
    const d = -ageDays;
    return `out in ${d} ${d === 1 ? "day" : "days"}`;
  }
  if (ageDays < 14) return `${ageDays} ${ageDays === 1 ? "day" : "days"} old`;
  if (ageDays < 60) return `${Math.round(ageDays / 7)} weeks old`;
  if (ageDays < 700) return `${Math.round(ageDays / 30.4)} months old`;
  const years = Math.round((ageDays / 365) * 10) / 10;
  return `${years} years old`;
}

/** "next 2 months" style label for a stretch of days. */
export function spanLabel(days: number): string {
  if (days < 45) return `next ${days} days`;
  const months = Math.round(days / 30.4);
  return `next ${months} ${months === 1 ? "month" : "months"}`;
}
