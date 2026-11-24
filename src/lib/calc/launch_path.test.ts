import { describe, expect, it } from "vitest";
import { AGES, type AgedProduct } from "./age_curve";
import { launchPath } from "./launch_path";

const prices = (at: Record<number, number>) => AGES.map((a) => at[a] ?? null);

/** Boxes costing 100 a week before release and `r0`, `r30` at release / day 30. */
const cohort = (rows: Array<[number, number]>, language: "en" | "ja" = "en") =>
  rows.map(([r0, r30], i): AgedProduct => ({
    groupId: 10 + i,
    language,
    type: "box",
    prices: prices({ [-7]: 100, 0: r0, 30: r30 }),
  }));

describe("launchPath", () => {
  const five = cohort([
    [90, 80],
    [100, 90],
    [110, 100],
    [120, 110],
    [130, 120],
  ]);

  it("reports the typical change to each later target age", () => {
    const steps = launchPath(five, { kind: "box", language: "en", fromAge: -7 });
    expect(steps.map((s) => s.toAge)).toEqual([0, 30]); // 7 and 90 have no data
    const rel = steps[0];
    expect(rel.median).toBeCloseTo(0.1, 10); // 110/100 - 1
    expect(rel.p25).toBeCloseTo(0, 10);
    expect(rel.p75).toBeCloseTo(0.2, 10);
    expect(rel.sets).toBe(5);
    expect(rel.shareUp).toBeCloseTo(0.6, 10);
    expect(steps[1].median).toBeCloseTo(0, 10); // median of 100 → 0%
  });

  it("only looks ahead of the starting age", () => {
    const steps = launchPath(five, { kind: "box", language: "en", fromAge: 0 });
    expect(steps.every((s) => s.toAge > 0)).toBe(true);
  });

  it("leaves out steps with too few sets", () => {
    const four = five.slice(0, 4);
    expect(launchPath(four, { kind: "box", language: "en", fromAge: -7 })).toEqual([]);
  });

  it("matches kind and language", () => {
    expect(launchPath(five, { kind: "etb", language: "en", fromAge: -7 })).toEqual([]);
    expect(launchPath(five, { kind: "box", language: "ja", fromAge: -7 })).toEqual([]);
  });

  it("leaves a set out of its own comparison", () => {
    const withSelf = [
      ...five,
      ...cohort([[1000, 1000]]).map((p) => ({ ...p, groupId: 99 })),
    ];
    const a = launchPath(five, { kind: "box", language: "en", fromAge: -7 });
    const b = launchPath(withSelf, {
      kind: "box",
      language: "en",
      fromAge: -7,
      excludeGroupId: 99,
    });
    expect(b).toEqual(a);
  });

  it("honours custom targets", () => {
    const steps = launchPath(five, {
      kind: "box",
      language: "en",
      fromAge: -7,
      targets: [30],
    });
    expect(steps.map((s) => s.toAge)).toEqual([30]);
  });
});
