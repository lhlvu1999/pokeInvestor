import { describe, expect, it } from "vitest";
import {
  excessText,
  indexLevelOn,
  pmeCompare,
  type BenchEvent,
} from "./pme";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** An index that is 100 on 2025-01-01, 200 on 2026-01-01 (linear in between by points). */
const doubling = [
  { day: "2025-01-01", value: 100 },
  { day: "2025-07-01", value: 150 },
  { day: "2026-01-01", value: 200 },
];

const ev = (
  at: string,
  type: "buy" | "sell",
  amount: number,
  series: BenchEvent["series"] = doubling,
): BenchEvent => ({ at: d(at), type, amount, series });

describe("indexLevelOn", () => {
  it("is the latest point on or before the day", () => {
    expect(indexLevelOn(doubling, "2025-01-01")).toBe(100);
    expect(indexLevelOn(doubling, "2025-03-15")).toBe(100);
    expect(indexLevelOn(doubling, "2025-07-01")).toBe(150);
    expect(indexLevelOn(doubling, "2030-01-01")).toBe(200);
  });
  it("is null before the index begins", () => {
    expect(indexLevelOn(doubling, "2024-12-31")).toBeNull();
    expect(indexLevelOn([], "2025-01-01")).toBeNull();
  });
});

describe("pmeCompare", () => {
  const now = d("2026-01-01");

  it("compares your result with the same money in the index", () => {
    // Spent 100 on day one of the index; index doubled, you tripled.
    const r = pmeCompare([ev("2025-01-01", "buy", 100)], 300, now);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.days).toBe(365);
    expect(r.yourRate).toBeCloseTo(2, 6); // 100 → 300 in a year: +200%
    expect(r.indexRate).toBeCloseTo(1, 6); // 100 → 200: +100%
    expect(r.excess).toBeCloseTo(1, 6);
    expect(r.indexValue).toBeCloseTo(200, 9);
    expect(r.yourValue).toBe(300);
    expect(r.valueDiff).toBeCloseTo(100, 9);
    expect(r.extrapolated).toBe(false);
  });

  it("scales each buy by how far the index moved since it", () => {
    // 100 at index 100 and 150 at index 150 → 1 unit each → 2 units × 200.
    const r = pmeCompare(
      [ev("2025-01-01", "buy", 100), ev("2025-07-01", "buy", 150)],
      500,
      now,
    );
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.indexValue).toBeCloseTo(400, 9);
    expect(r.valueDiff).toBeCloseTo(100, 9);
  });

  it("treats a sale as selling index units that day", () => {
    // Buy 100 (1 unit), sell 150 at index 150 (1 unit): nothing left in the
    // index. You sold at 150 and hold 80 → a 230 outcome vs the index's 150.
    const r = pmeCompare(
      [ev("2025-01-01", "buy", 100), ev("2025-07-01", "sell", 150)],
      80,
      now,
    );
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.indexValue).toBeCloseTo(0, 9);
    expect(r.indexRate).toBeNull(); // nothing left to value: no single rate
  });

  it("can leave a negative index value when you took out more than the index could", () => {
    // Sold more than was bought into the index, so it would be short.
    const r = pmeCompare(
      [ev("2025-01-01", "buy", 100), ev("2025-07-01", "sell", 300)],
      0,
      now,
    );
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.indexValue).toBeLessThan(0);
    expect(r.indexRate).toBeNull();
    expect(r.valueDiff).toBeGreaterThan(0);
  });

  it("is held back under 90 days", () => {
    const r = pmeCompare(
      [ev("2025-11-01", "buy", 100)],
      130,
      d("2025-12-01"),
    );
    expect(r).toEqual({ status: "too_early", days: 30, daysToGo: 60 });
  });

  it("refuses when a purchase predates the index", () => {
    const r = pmeCompare([ev("2024-06-01", "buy", 100)], 300, now);
    expect(r).toEqual({ status: "unavailable", reason: "before_index" });
  });

  it("refuses without an index or with a stale one", () => {
    expect(pmeCompare([ev("2025-01-01", "buy", 100, null)], 300, now)).toEqual({
      status: "unavailable",
      reason: "no_index",
    });
    expect(
      pmeCompare([ev("2025-01-01", "buy", 100)], 300, d("2026-03-01")),
    ).toEqual({ status: "unavailable", reason: "no_index" });
  });

  it("reports nothing to compare with no activity", () => {
    expect(pmeCompare([], 0, now)).toEqual({
      status: "unavailable",
      reason: "no_activity",
    });
  });

  it("uses each event's own index", () => {
    const flat = [
      { day: "2025-01-01", value: 100 },
      { day: "2026-01-01", value: 100 },
    ];
    const r = pmeCompare(
      [ev("2025-01-01", "buy", 100, doubling), ev("2025-01-01", "buy", 100, flat)],
      0,
      now,
    );
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.indexValue).toBeCloseTo(200 + 100, 9);
  });

  it("flags a rate from under a year as a projection", () => {
    const r = pmeCompare([ev("2025-01-01", "buy", 100)], 150, d("2025-08-01"));
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.extrapolated).toBe(true);
  });
});

describe("excessText", () => {
  it("describes the gap in points", () => {
    expect(excessText(0.2234)).toBe("22.3 points ahead");
    expect(excessText(-0.041)).toBe("4.1 points behind");
    expect(excessText(0)).toBe("level with the index");
    expect(excessText(0.0004)).toBe("level with the index");
    expect(excessText(12)).toBe("more than 1,000 points ahead");
    expect(excessText(-12)).toBe("more than 1,000 points behind");
  });
});
