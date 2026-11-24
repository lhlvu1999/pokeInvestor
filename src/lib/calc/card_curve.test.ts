import { describe, expect, it } from "vitest";
import { AGES } from "./age_curve";
import {
  comparableCoverage,
  setCurve,
  type AgedSet,
} from "./card_curve";

const grid = (at: Record<number, number>) => AGES.map((a) => at[a] ?? null);

/** A set with the same priced count (100) at base 14 and 90, top-20 `v14` → `v90`. */
function set(
  groupId: number,
  v14: number,
  v90: number,
  over: Partial<AgedSet> = {},
  priced: Record<number, number> = { 14: 100, 90: 100 },
): AgedSet {
  return {
    groupId,
    language: "en",
    priced: grid(priced),
    top20: grid({ 14: v14, 90: v90 }),
    top10: grid({ 14: v14 / 2, 90: v90 / 2 }),
    total: grid({ 14: v14 * 3, 90: v90 * 3 }),
    ...over,
  };
}

describe("comparableCoverage", () => {
  it("needs the two counts within 10% of each other", () => {
    expect(comparableCoverage(100, 100)).toBe(true);
    expect(comparableCoverage(90, 100)).toBe(true);
    expect(comparableCoverage(100, 90)).toBe(true);
    expect(comparableCoverage(89, 100)).toBe(false);
    expect(comparableCoverage(0, 100)).toBe(false);
    expect(comparableCoverage(100, -1)).toBe(false);
  });
});

describe("setCurve", () => {
  const five = [80, 90, 100, 110, 120].map((v90, i) => set(i + 1, 100, v90));

  it("is the median change of the chosen metric since the base age", () => {
    const c = setCurve(five, { metric: "top20", baseAge: 14 });
    const p = c.find((x) => x.age === 90)!;
    expect(p.sets).toBe(5);
    expect(p.median).toBeCloseTo(0, 10);
    expect(p.p25).toBeCloseTo(-0.1, 10);
    expect(p.p75).toBeCloseTo(0.1, 10);
    expect(p.shareUp).toBeCloseTo(0.4, 10);
  });

  it("reads the other metrics from their own series", () => {
    const rising = [10, 20, 30, 40, 50].map((x, i) => ({
      ...set(i + 1, 100, 100),
      top10: grid({ 14: 100, 90: 100 + x }),
    }));
    const p = setCurve(rising, { metric: "top10", baseAge: 14 }).find(
      (x) => x.age === 90,
    )!;
    expect(p.median).toBeCloseTo(0.3, 10);
    const flat = setCurve(rising, { metric: "top20", baseAge: 14 }).find(
      (x) => x.age === 90,
    )!;
    expect(flat.median).toBeCloseTo(0, 10);
  });

  it("leaves a set out when its priced count changed too much (a card gaining a price)", () => {
    // Set 6's top-20 triples, but only because its priced count grew 60 → 100.
    const growing = set(6, 100, 300, {}, { 14: 60, 90: 100 });
    const c = setCurve([...five, growing], { metric: "top20", baseAge: 14 });
    const p = c.find((x) => x.age === 90)!;
    expect(p.sets).toBe(5); // the growing set is not counted
    expect(p.median).toBeCloseTo(0, 10);
  });

  it("includes it once the counts match", () => {
    const settled = set(6, 100, 300, {}, { 14: 96, 90: 100 });
    const p = setCurve([...five, settled], {
      metric: "top20",
      baseAge: 14,
    }).find((x) => x.age === 90)!;
    expect(p.sets).toBe(6);
  });

  it("applies the rule per age, not per set", () => {
    // Priced 60 at base and at 30, but 100 at 90: counts at 30 match, 90 doesn't.
    const s = (id: number) =>
      set(id, 100, 150, { top20: grid({ 14: 100, 30: 120, 90: 150 }) }, {
        14: 60,
        30: 62,
        90: 100,
      });
    const c = setCurve([1, 2, 3, 4, 5].map(s), {
      metric: "top20",
      baseAge: 14,
    });
    expect(c.find((x) => x.age === 30)?.sets).toBe(5);
    expect(c.find((x) => x.age === 90)).toBeUndefined();
  });

  it("hides ages with too few sets and sets with no usable figures", () => {
    expect(setCurve(five.slice(0, 4), { metric: "top20", baseAge: 14 })).toEqual([]);
    const missing = [...five.slice(0, 4), set(9, 0, 100)];
    expect(setCurve(missing, { metric: "top20", baseAge: 14 })).toEqual([]);
  });

  it("filters by language and rejects a base age off the grid", () => {
    const mixed = [
      ...five,
      ...five.map((s) => ({ ...s, groupId: s.groupId + 50, language: "ja" as const })),
    ];
    expect(
      setCurve(mixed, { metric: "top20", baseAge: 14, language: "ja" }).find(
        (x) => x.age === 90,
      )!.sets,
    ).toBe(5);
    expect(
      setCurve(mixed, { metric: "top20", baseAge: 14 }).find((x) => x.age === 90)!
        .sets,
    ).toBe(10);
    expect(setCurve(five, { metric: "top20", baseAge: 3 })).toEqual([]);
  });

  it("treats NaN as missing", () => {
    const nan = [...five, set(7, Number.NaN, 100)];
    expect(
      setCurve(nan, { metric: "top20", baseAge: 14 }).find((x) => x.age === 90)!
        .sets,
    ).toBe(5);
  });
});
