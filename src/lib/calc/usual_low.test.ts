import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGES, type AgedProduct, type CurvePoint } from "./age_curve";
import {
  atUsualLow,
  usualLow,
  usualLowOf,
  LOW_WINDOW_DAYS,
} from "./usual_low";

const pt = (age: number, median: number, sets = 10): CurvePoint => ({
  age,
  sets,
  median,
  p25: median - 0.05,
  p75: median + 0.05,
  shareUp: 0.3,
});

describe("usualLowOf", () => {
  const curve = [
    pt(7, 0),
    pt(30, -0.08),
    pt(60, -0.15),
    pt(90, -0.1),
    pt(180, 0.02),
  ];

  it("is the age with the lowest median", () => {
    const low = usualLowOf(curve)!;
    expect(low.age).toBe(60);
    expect(low.median).toBeCloseTo(-0.15, 12);
    expect(low.sets).toBe(10);
  });

  it("is null when there's no real dip", () => {
    expect(usualLowOf([pt(7, 0), pt(30, -0.03), pt(60, 0.1)])).toBeNull();
    expect(usualLowOf([pt(7, 0), pt(30, -0.05)])!.age).toBe(30); // exactly 5%
  });

  it("ignores the base age itself, ages beyond a year, and thin ages", () => {
    expect(usualLowOf([pt(7, -0.9), pt(30, -0.02)])).toBeNull();
    expect(usualLowOf([pt(30, -0.02), pt(450, -0.5)])).toBeNull();
    const thin = [pt(30, -0.1, 10), pt(60, -0.4, 5)];
    expect(usualLowOf(thin)!.age).toBe(30);
  });

  it("keeps the earlier age on a tie", () => {
    expect(usualLowOf([pt(30, -0.1), pt(60, -0.1)])!.age).toBe(30);
  });

  it("is null for an empty curve", () => {
    expect(usualLowOf([])).toBeNull();
  });
});

describe("usualLow", () => {
  const grid = (at: Record<number, number>) => AGES.map((a) => at[a] ?? null);
  // Ten boxes: 100 at day 7, 80 at day 60, 100 at day 180.
  const cohort: AgedProduct[] = Array.from({ length: 10 }, (_, i) => ({
    groupId: i + 1,
    language: "en",
    type: "box",
    prices: grid({ 7: 100, 30: 90, 60: 80, 180: 100 }),
  }));

  it("finds the low from a cohort of products", () => {
    const low = usualLow(cohort, "box", "en")!;
    expect(low.age).toBe(60);
    expect(low.median).toBeCloseTo(-0.2, 12);
    expect(low.sets).toBe(10);
  });

  it("needs 8 sets, and the right kind and language", () => {
    expect(usualLow(cohort.slice(0, 7), "box", "en")).toBeNull();
    expect(usualLow(cohort, "etb", "en")).toBeNull();
    expect(usualLow(cohort, "box", "ja")).toBeNull();
  });
});

describe("atUsualLow", () => {
  const low = { age: 60, median: -0.15, p25: -0.2, p75: -0.1, sets: 10 };
  it("is true within the window either side", () => {
    expect(atUsualLow(60, low)).toBe(true);
    expect(atUsualLow(60 - LOW_WINDOW_DAYS, low)).toBe(true);
    expect(atUsualLow(60 + LOW_WINDOW_DAYS, low)).toBe(true);
    expect(atUsualLow(60 - LOW_WINDOW_DAYS - 1, low)).toBe(false);
    expect(atUsualLow(60 + LOW_WINDOW_DAYS + 1, low)).toBe(false);
  });
});

describe("agreement with the Python implementation", () => {
  // The same file is checked by pipeline/tests/test_stage_alerts.py.
  const fx = JSON.parse(
    readFileSync("pipeline/tests/fixtures/usual_low_vectors.json", "utf8"),
  ) as {
    products: {
      group_id: number;
      kind: "box" | "etb" | "bundle" | "pack";
      language: "en" | "ja";
      prices: Record<string, number | null>;
    }[];
    expected: Record<
      string,
      { age: number; median: number; p25: number; p75: number; sets: number } | null
    >;
  };
  const cohort: AgedProduct[] = fx.products.map((p) => ({
    groupId: p.group_id,
    language: p.language,
    type: p.kind,
    prices: AGES.map((a) => p.prices[String(a)] ?? null),
  }));

  it("finds the recorded usual low for every kind and language", () => {
    for (const [key, want] of Object.entries(fx.expected)) {
      const [kind, lang] = key.split(":") as [
        "box" | "etb" | "bundle" | "pack",
        "en" | "ja",
      ];
      const low = usualLow(cohort, kind, lang);
      if (want == null) {
        expect(low, key).toBeNull();
      } else {
        expect(low, key).not.toBeNull();
        expect(low!.age).toBe(want.age);
        expect(low!.sets).toBe(want.sets);
        expect(low!.median).toBeCloseTo(want.median, 12);
        expect(low!.p25).toBeCloseTo(want.p25, 12);
        expect(low!.p75).toBeCloseTo(want.p75, 12);
      }
    }
    expect(Object.values(fx.expected).filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });
});
