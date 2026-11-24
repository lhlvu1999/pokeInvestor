import { describe, expect, it } from "vitest";
import {
  changeOver,
  fromLaunch,
  daysBetween,
  downsample,
  linePath,
  scaleSeries,
  sharedDomain,
  type Point,
} from "./set_history";

const p = (day: string, cents: number): Point => ({ day, cents });

describe("daysBetween", () => {
  it("counts whole days, across months and years", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // leap year
    expect(daysBetween("2026-05-01", "2026-05-01")).toBe(0);
    expect(daysBetween("2026-05-02", "2026-05-01")).toBe(-1);
  });
});

describe("changeOver", () => {
  const series = [
    p("2026-01-01", 100),
    p("2026-02-01", 200),
    p("2026-03-01", 150),
  ];

  it("compares the newest point with the price that many days earlier", () => {
    // 28 days before Mar 1 is Feb 1 (200); 150/200 − 1 = −25%
    expect(changeOver(series, 28)).toBeCloseTo(-0.25, 10);
  });

  it("uses the latest point on or before the target day", () => {
    // 45 days before Mar 1 is Jan 15; latest on or before is Jan 1 (100)
    expect(changeOver(series, 45)).toBeCloseTo(0.5, 10);
  });

  it("is null when the series doesn't reach back far enough", () => {
    expect(changeOver(series, 365)).toBeNull();
    expect(changeOver([p("2026-03-01", 100)], 1)).toBeNull();
  });

  it("is null for an empty series or a zero starting price", () => {
    expect(changeOver([], 30)).toBeNull();
    expect(
      changeOver([p("2026-01-01", 0), p("2026-03-01", 50)], 30),
    ).toBeNull();
  });

  it("a window of zero days compares the newest point with itself", () => {
    expect(changeOver(series, 0)).toBe(0);
  });
});

describe("downsample", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);

  it("returns everything when it already fits", () => {
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
    expect(downsample([], 5)).toEqual([]);
  });

  it("keeps the first and last and respects the maximum", () => {
    const out = downsample(items, 10);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(99);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out).toEqual([...out].sort((a, b) => a - b));
  });

  it("never duplicates a point", () => {
    const out = downsample(items, 99);
    expect(new Set(out).size).toBe(out.length);
  });

  it("does not modify its input", () => {
    const copy = [...items];
    downsample(items, 5);
    expect(items).toEqual(copy);
  });

  it("falls back to everything for a nonsensical maximum", () => {
    expect(downsample([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });
});

describe("scaleSeries", () => {
  it("puts the lowest value at the bottom and the highest at the top", () => {
    const pts = scaleSeries(
      [p("2026-01-01", 10), p("2026-01-11", 30)],
      100,
      50,
    );
    expect(pts[0]).toEqual({ x: 0, y: 50 });
    expect(pts[1]).toEqual({ x: 100, y: 0 });
  });

  it("spaces points by real date, so a gap in the data shows as a gap", () => {
    const pts = scaleSeries(
      [p("2026-01-01", 1), p("2026-01-02", 2), p("2026-01-11", 3)],
      100,
      10,
    );
    expect(pts[1].x).toBeCloseTo(10, 5);
    expect(pts[2].x).toBe(100);
  });

  it("draws a flat series mid-height and a single point centred", () => {
    expect(
      scaleSeries([p("2026-01-01", 5), p("2026-01-05", 5)], 100, 40).map(
        (q) => q.y,
      ),
    ).toEqual([20, 20]);
    expect(scaleSeries([p("2026-01-01", 5)], 100, 40)).toEqual([
      { x: 50, y: 20 },
    ]);
  });

  it("can use a shared domain so two lines are comparable", () => {
    const a = scaleSeries([p("2026-01-01", 50), p("2026-01-03", 50)], 10, 100, {
      min: 0,
      max: 100,
    });
    expect(a.map((q) => q.y)).toEqual([50, 50]);
  });

  it("returns nothing for an empty series", () => {
    expect(scaleSeries([], 100, 100)).toEqual([]);
  });
});

describe("linePath / sharedDomain", () => {
  it("builds an SVG path, and an empty string for no points", () => {
    expect(
      linePath([
        { x: 0, y: 10 },
        { x: 5.56, y: 2.25 },
      ]),
    ).toBe("M0.0,10.0 L5.6,2.3");
    expect(linePath([])).toBe("");
  });

  it("spans every series, and is null when there are none", () => {
    expect(
      sharedDomain(
        [p("2026-01-01", 5)],
        [p("2026-01-01", 20), p("2026-01-02", 1)],
      ),
    ).toEqual({ min: 1, max: 20 });
    expect(sharedDomain([], [])).toBeNull();
  });
});

describe("fromLaunch", () => {
  const pt = (day: string, priced: number) => ({ day, priced });

  it("drops the pre-launch days when the set has barely any priced cards", () => {
    const series = [
      pt("d1", 0),
      pt("d2", 3),
      pt("d3", 160),
      pt("d4", 340),
      pt("d5", 355),
    ];
    // 50% of 355 priced cards is 178, first reached on d4.
    expect(fromLaunch(series).map((p) => p.day)).toEqual(["d4", "d5"]);
  });

  it("keeps everything for a set that was fully priced from the start", () => {
    const series = [pt("d1", 100), pt("d2", 100), pt("d3", 101)];
    expect(fromLaunch(series)).toEqual(series);
  });

  it("starts exactly on the day the threshold is met, not after it", () => {
    const series = [pt("d1", 49), pt("d2", 50), pt("d3", 100)];
    expect(fromLaunch(series).map((p) => p.day)).toEqual(["d2", "d3"]);
  });

  it("keeps a set that never reaches the threshold, rather than showing nothing", () => {
    expect(fromLaunch([pt("d1", 0), pt("d2", 0)])).toHaveLength(2);
  });

  it("copes with empty input and does not modify it", () => {
    expect(fromLaunch([])).toEqual([]);
    const series = [pt("d1", 0), pt("d2", 10)];
    const copy = [...series];
    fromLaunch(series);
    expect(series).toEqual(copy);
  });

  it("honours a different share", () => {
    const series = [pt("d1", 10), pt("d2", 80), pt("d3", 100)];
    expect(fromLaunch(series, 0.9).map((p) => p.day)).toEqual(["d3"]);
  });
});
