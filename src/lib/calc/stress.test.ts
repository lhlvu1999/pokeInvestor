import { describe, expect, it } from "vitest";
import { mixIndex, worstWindow } from "./stress";

const days = (start: string, values: number[]) =>
  values.map((value, i) => ({
    day: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000)
      .toISOString()
      .slice(0, 10),
    value,
  }));

describe("mixIndex", () => {
  it("blends indexes by weight, 100 on the first common day", () => {
    const up = days("2026-01-01", [100, 110, 121]); // +10% a day
    const flat = days("2026-01-01", [100, 100, 100]);
    const mix = mixIndex([
      { weight: 3, series: up },
      { weight: 1, series: flat },
    ]);
    expect(mix.map((p) => p.day)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(mix[0].value).toBeCloseTo(100, 12);
    expect(mix[1].value).toBeCloseTo(100 * (0.75 * 1.1 + 0.25), 12);
    expect(mix[2].value).toBeCloseTo(100 * (0.75 * 1.21 + 0.25), 12);
  });

  it("starts when the youngest component does, using only shared days", () => {
    const a = days("2026-01-01", [100, 101, 102, 103]);
    const b = days("2026-01-03", [50, 55]); // starts later
    const mix = mixIndex([
      { weight: 1, series: a },
      { weight: 1, series: b },
    ]);
    expect(mix.map((p) => p.day)).toEqual(["2026-01-03", "2026-01-04"]);
    expect(mix[0].value).toBeCloseTo(100, 12);
    // a: 103/102, b: 55/50, equal weights.
    expect(mix[1].value).toBeCloseTo(100 * (0.5 * (103 / 102) + 0.5 * 1.1), 12);
  });

  it("ignores zero weights and returns nothing when there's nothing to blend", () => {
    expect(mixIndex([])).toEqual([]);
    expect(mixIndex([{ weight: 0, series: days("2026-01-01", [1, 2]) }])).toEqual([]);
    expect(mixIndex([{ weight: 1, series: days("2026-01-01", [1]) }])).toEqual([]);
    const only = mixIndex([
      { weight: 1, series: days("2026-01-01", [100, 120]) },
      { weight: 0, series: days("2026-06-01", [1, 1]) }, // no weight, no effect
    ]);
    expect(only).toHaveLength(2);
  });
});

describe("worstWindow", () => {
  it("finds the biggest fall over a stretch of days", () => {
    // 100, 100, 100, 80, 80, 90: over 2 days the worst is 100 → 80.
    const s = days("2026-01-01", [100, 100, 100, 80, 80, 90]);
    const w = worstWindow(s, 2)!;
    expect(w.change).toBeCloseTo(-0.2, 12);
    expect(w.toDay).toBe("2026-01-04");
    expect(w.fromDay).toBe("2026-01-02");
  });

  it("uses the latest start at least the window ago", () => {
    const s = days("2026-01-01", [100, 90, 100, 100, 70]);
    const w = worstWindow(s, 3)!;
    // Ends day 5 (70); starts day 2 (90): -22.2%, not day 1 (100): that's 4 days.
    expect(w.fromDay).toBe("2026-01-02");
    expect(w.change).toBeCloseTo(70 / 90 - 1, 12);
  });

  it("can report a window with no fall at all", () => {
    const w = worstWindow(days("2026-01-01", [100, 101, 103, 106]), 2)!;
    expect(w.change).toBeGreaterThan(0);
  });

  it("is null when the series is shorter than the window", () => {
    expect(worstWindow(days("2026-01-01", [100, 90, 80]), 5)).toBeNull();
    expect(worstWindow([], 30)).toBeNull();
  });

  it("spans real calendar days across a gap", () => {
    const s = [
      { day: "2026-01-01", value: 100 },
      { day: "2026-01-31", value: 60 },
    ];
    expect(worstWindow(s, 30)!.change).toBeCloseTo(-0.4, 12);
    expect(worstWindow(s, 31)).toBeNull();
  });
});
