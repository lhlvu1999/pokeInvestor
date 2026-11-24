import { describe, expect, it } from "vitest";
import {
  AGES,
  ageCurve,
  nearestAge,
  pointAt,
  quantile,
  typicalAt,
  type AgedProduct,
  type CurvePoint,
} from "./age_curve";

/** Prices at each age: `at` maps age → cents, anything else is missing. */
function product(
  groupId: number,
  at: Record<number, number>,
  extra: Partial<AgedProduct> = {},
): AgedProduct {
  return {
    groupId,
    language: "en",
    type: "box",
    prices: AGES.map((a) => at[a] ?? null),
    ...extra,
  };
}

describe("quantile", () => {
  it("interpolates", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10, 20], 0.25)).toBe(12.5);
    expect(quantile([5], 0.9)).toBe(5);
    expect(quantile([3, 1, 2], 0)).toBe(1);
    expect(quantile([3, 1, 2], 1)).toBe(3);
  });
  it("is NaN for nothing", () => {
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe("ageCurve", () => {
  // Five sets, each launching at 100 and reaching a different price at 30 days.
  const sets = [60, 80, 100, 120, 160].map((p, i) =>
    product(i + 1, { 0: 100, 30: p }),
  );

  it("is the median and quartiles of change since the base age", () => {
    const curve = ageCurve(sets, { type: "box", baseAge: 0 });
    const p = pointAt(curve, 30)!;
    expect(p.sets).toBe(5);
    expect(p.median).toBeCloseTo(0, 10); // median price 100 → 0%
    expect(p.p25).toBeCloseTo(-0.2, 10);
    expect(p.p75).toBeCloseTo(0.2, 10);
    expect(p.shareUp).toBeCloseTo(0.4, 10); // 120 and 160 are up; 100 is flat
  });

  it("the base age itself is a flat zero line point", () => {
    const p = pointAt(ageCurve(sets, { type: "box", baseAge: 0 }), 0)!;
    expect(p.median).toBe(0);
    expect(p.shareUp).toBe(0);
  });

  it("hides ages with too few sets", () => {
    const curve = ageCurve(sets.slice(0, 4), { type: "box", baseAge: 0 });
    expect(curve).toEqual([]);
    const lower = ageCurve(sets.slice(0, 4), {
      type: "box",
      baseAge: 0,
      minSets: 4,
    });
    expect(lower.map((p) => p.age)).toEqual([0, 30]);
  });

  it("only counts a set when it has a price at both ages", () => {
    const withGap = [...sets, product(9, { 30: 500 })]; // no launch price
    const p = pointAt(ageCurve(withGap, { type: "box", baseAge: 0 }), 30)!;
    expect(p.sets).toBe(5);
  });

  it("measures from a later base and drops the ages before it", () => {
    const later = [10, 20, 30, 40, 50].map((p, i) =>
      product(i + 1, { 0: 1, 7: 100, 30: 100 + p }),
    );
    const curve = ageCurve(later, { type: "box", baseAge: 7 });
    expect(curve[0].age).toBe(7);
    expect(pointAt(curve, 0)).toBeNull();
    expect(pointAt(curve, 30)!.median).toBeCloseTo(0.3, 10);
  });

  it("counts a set once however many products it has", () => {
    // Set 1 has three boxes; its value is their median change (+50%), not
    // three votes.
    const crowded = [
      product(1, { 0: 100, 30: 150 }),
      product(1, { 0: 100, 30: 150 }),
      product(1, { 0: 100, 30: 500 }),
      ...[0, 0, 0, 0].map((_, i) => product(i + 2, { 0: 100, 30: 100 })),
    ];
    const p = pointAt(ageCurve(crowded, { type: "box", baseAge: 0 }), 30)!;
    expect(p.sets).toBe(5);
    expect(p.median).toBe(0);
    expect(p.p75).toBe(0); // [0,0,0,0,0.5] → upper quartile still 0
  });

  it("filters by type and language", () => {
    const mixed = [
      ...sets,
      ...sets.map((s) => ({
        ...s,
        groupId: s.groupId + 100,
        type: "etb" as const,
      })),
      ...sets.map((s) => ({
        ...s,
        groupId: s.groupId + 200,
        language: "ja" as const,
      })),
    ];
    expect(
      pointAt(ageCurve(mixed, { type: "box", baseAge: 0 }), 30)!.sets,
    ).toBe(10);
    expect(
      pointAt(ageCurve(mixed, { type: "box", baseAge: 0, language: "ja" }), 30)!
        .sets,
    ).toBe(5);
    expect(
      pointAt(ageCurve(mixed, { type: "etb", baseAge: 0 }), 30)!.sets,
    ).toBe(5);
    expect(ageCurve(mixed, { type: "bundle", baseAge: 0 })).toEqual([]);
  });

  it("ignores zero or missing prices rather than dividing by them", () => {
    const zero = [...sets, product(9, { 0: 0, 30: 100 })];
    const p = pointAt(ageCurve(zero, { type: "box", baseAge: 0 }), 30)!;
    expect(p.sets).toBe(5);
  });

  it("treats NaN prices as missing", () => {
    const nan = [...sets, product(9, { 0: Number.NaN, 30: 100 }), product(10, { 0: 100, 30: Number.NaN })];
    const p = pointAt(ageCurve(nan, { type: "box", baseAge: 0 }), 30)!;
    expect(p.sets).toBe(5);
    expect(p.median).toBeCloseTo(0, 10);
  });

  it("returns nothing for a base age that isn't on the grid", () => {
    expect(ageCurve(sets, { type: "box", baseAge: 3 })).toEqual([]);
  });
});

describe("typicalAt", () => {
  const pt = (age: number, median: number, sets = 10): CurvePoint => ({
    age,
    sets,
    median,
    p25: median - 0.1,
    p75: median + 0.1,
    shareUp: 0.5,
  });
  // Adjacent grid ages 30 and 45.
  const curve = [pt(30, 0.1, 12), pt(45, 0.4, 9)];

  it("is the point itself at an exact age", () => {
    expect(typicalAt(curve, 30)).toEqual({
      median: 0.1,
      p25: 0,
      p75: 0.2,
      sets: 12,
    });
  });

  it("interpolates linearly between adjacent ages", () => {
    const t = typicalAt(curve, 35)!; // a third of the way
    expect(t.median).toBeCloseTo(0.2, 10);
    expect(t.p25).toBeCloseTo(0.1, 10);
    expect(t.p75).toBeCloseTo(0.3, 10);
    expect(t.sets).toBe(9); // the fewer of the two
  });

  it("is null outside the curve", () => {
    expect(typicalAt(curve, 10)).toBeNull();
    expect(typicalAt(curve, 100)).toBeNull();
    expect(typicalAt([], 30)).toBeNull();
  });

  it("won't bridge a gap of missing ages", () => {
    // 30 and 90 are not neighbours on the grid (45, 60, 75 sit between).
    expect(typicalAt([pt(30, 0.1), pt(90, 0.5)], 60)).toBeNull();
  });
});

describe("nearestAge", () => {
  it("picks the closest grid age", () => {
    expect(nearestAge(0)).toBe(0);
    expect(nearestAge(12)).toBe(14);
    expect(nearestAge(100)).toBe(90);
    expect(nearestAge(5000)).toBe(900);
    expect(nearestAge(-20)).toBe(-21); // pre-order ages are on the grid
    expect(nearestAge(-100)).toBe(-60);
  });
  it("breaks ties toward the younger age", () => {
    expect(nearestAge(3.5)).toBe(0); // 0 and 7 are 3.5 away
  });
});
