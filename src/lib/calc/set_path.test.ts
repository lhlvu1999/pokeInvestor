import { describe, expect, it } from "vitest";
import { pathAt, setPath } from "./set_path";
import type { SetDay } from "./set_tracking";

const day = (d: string, priced: number, top20: number, over: Partial<SetDay> = {}): SetDay => ({
  day: d,
  priced,
  top20,
  top10: top20 / 2,
  total: top20 * 3,
  ...over,
});

const REL = "2026-01-01";

describe("setPath", () => {
  const days = [
    day("2026-01-15", 100, 1000), // day 14
    day("2026-01-16", 100, 900),
    day("2026-02-14", 100, 800), // day 44
  ];

  it("is the change since the starting day, by age", () => {
    const p = setPath(days, REL, "top20", 14);
    expect(p).toHaveLength(3);
    expect(p[0]).toEqual({ age: 14, change: 0 });
    expect(p[1].age).toBe(15);
    expect(p[1].change).toBeCloseTo(-0.1, 12);
    expect(p[2].age).toBe(44);
    expect(p[2].change).toBeCloseTo(-0.2, 12);
  });

  it("reads the chosen value", () => {
    const top10 = setPath(days, REL, "top10", 14);
    expect(top10[2].change).toBeCloseTo(-0.2, 12); // same ratio, different series
    const total = setPath(
      [day("2026-01-15", 100, 1, { total: 100 }), day("2026-04-01", 100, 1, { total: 150 })],
      REL,
      "total",
      14,
    );
    expect(total[1].change).toBeCloseTo(0.5, 12);
  });

  it("leaves out days whose priced-card count moved too far from the start", () => {
    const p = setPath(
      [
        day("2026-01-15", 100, 1000),
        day("2026-02-01", 60, 3000), // cards gaining prices: not comparable
        day("2026-03-01", 95, 800), // within 10%: counts
      ],
      REL,
      "top20",
      14,
    );
    expect(p.map((x) => x.age)).toEqual([14, 59]);
  });

  it("is empty when the history doesn't reach the starting age", () => {
    expect(setPath([day("2026-03-01", 100, 800)], REL, "top20", 14)).toEqual([]);
  });

  it("is empty when nothing was priced at the start", () => {
    expect(setPath([day("2026-01-15", 0, 0), day("2026-02-01", 100, 800)], REL, "top20", 14)).toEqual([]);
  });

  it("ignores days before the starting age and days with no value", () => {
    const p = setPath(
      [
        day("2026-01-08", 100, 5000), // day 7: before the base
        day("2026-01-15", 100, 1000),
        day("2026-02-01", 100, 0), // no value
        day("2026-02-14", 100, 800),
      ],
      REL,
      "top20",
      14,
    );
    expect(p.map((x) => x.age)).toEqual([14, 44]);
  });
});

describe("pathAt", () => {
  const p = [
    { age: 14, change: 0 },
    { age: 20, change: -0.05 },
    { age: 44, change: -0.2 },
  ];
  it("is the latest point on or before the age", () => {
    expect(pathAt(p, 14)).toEqual(p[0]);
    expect(pathAt(p, 30)).toEqual(p[1]);
    expect(pathAt(p, 1000)).toEqual(p[2]);
  });
  it("is null before the path starts", () => {
    expect(pathAt(p, 10)).toBeNull();
    expect(pathAt([], 10)).toBeNull();
  });
});
