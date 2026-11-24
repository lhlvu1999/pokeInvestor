/**
 * What earlier launches did from a given point: for a product at some age
 * (typically a few days or weeks before release, on pre-order), the typical
 * change in price by release day, a week after, a month after, and so on.
 */

import {
  ageCurve,
  pointAt,
  type AgedProduct,
  type CurvePoint,
} from "./age_curve";
import type { SealedType } from "./sealed_type";

/** Ages to report, in days since release. */
export const LAUNCH_TARGETS: ReadonlyArray<number> = [0, 7, 30, 90];

export type LaunchStep = Pick<
  CurvePoint,
  "median" | "p25" | "p75" | "sets" | "shareUp"
> & {
  /** Age (days since release) this step lands on. */
  toAge: number;
};

/**
 * Typical change from `fromAge` to each target age after it, for earlier
 * sets' products of this kind and language. Steps with too few sets behind
 * them are left out. `excludeGroupId` leaves a set out of its own comparison.
 */
export function launchPath(
  cohort: ReadonlyArray<AgedProduct>,
  options: {
    kind: SealedType;
    language: "en" | "ja";
    fromAge: number;
    excludeGroupId?: number;
    targets?: ReadonlyArray<number>;
  },
): LaunchStep[] {
  const {
    kind,
    language,
    fromAge,
    excludeGroupId,
    targets = LAUNCH_TARGETS,
  } = options;
  const others =
    excludeGroupId == null
      ? cohort
      : cohort.filter((p) => p.groupId !== excludeGroupId);
  const curve = ageCurve(others, { type: kind, baseAge: fromAge, language });

  const out: LaunchStep[] = [];
  for (const toAge of targets) {
    if (toAge <= fromAge) continue;
    const p = pointAt(curve, toAge);
    if (!p) continue;
    out.push({
      toAge,
      median: p.median,
      p25: p.p25,
      p75: p.p75,
      sets: p.sets,
      shareUp: p.shareUp,
    });
  }
  return out;
}
