import { describe, expect, it } from "vitest";
import {
  changeOver,
  formatDay,
  nearestIndex,
  priceDomain,
  windowSeries,
  type DrawerPoint,
  type DrawerTrade,
} from "./item_drawer";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 23); // 23 Nov 2026
const pt = (daysAgo: number, price: number): DrawerPoint => ({
  t: NOW - daysAgo * DAY,
  price,
});
const trade = (
  daysAgo: number,
  type: "buy" | "sell",
  unit: number,
): DrawerTrade => ({ t: NOW - daysAgo * DAY, type, qty: 1, unit });

describe("windowSeries", () => {
  const series = [
    pt(400, 50),
    pt(200, 80),
    pt(100, 90),
    pt(30, 100),
    pt(1, 110),
  ];

  it("returns everything for All", () => {
    const w = windowSeries(series, [], "all", NOW);
    expect(w.points).toHaveLength(5);
    expect(w.from).toBe(series[0].t);
  });

  it("clips to the range and anchors the left edge at the prior price", () => {
    const w = windowSeries(series, [], "3m", NOW);
    // 91 days back: snapshots at 30d and 1d are inside; the 100d point is
    // outside, so the line starts at the cutoff carrying the 100d price.
    expect(w.points.map((p) => p.price)).toEqual([90, 100, 110]);
    expect(w.points[0].t).toBe(NOW - 91 * DAY);
  });

  it("does not add an anchor when a point sits exactly on the cutoff", () => {
    const w = windowSeries([pt(100, 1), pt(91, 2), pt(5, 3)], [], "3m", NOW);
    expect(w.points.map((p) => p.price)).toEqual([2, 3]);
  });

  it("keeps only trades inside the window", () => {
    const w = windowSeries(
      series,
      [trade(300, "buy", 60), trade(20, "sell", 105)],
      "6m",
      NOW,
    );
    expect(w.trades).toHaveLength(1);
    expect(w.trades[0].type).toBe("sell");
  });

  it("with no inside points, draws a flat line from the last known price", () => {
    const w = windowSeries([pt(300, 70)], [], "3m", NOW);
    expect(w.points).toEqual([{ t: NOW - 91 * DAY, price: 70 }]);
  });

  it("copes with an empty series", () => {
    const w = windowSeries([], [trade(5, "buy", 10)], "all", NOW);
    expect(w.points).toEqual([]);
    expect(w.trades).toHaveLength(1);
  });

  it("sorts unsorted input", () => {
    const w = windowSeries([pt(1, 3), pt(50, 1), pt(20, 2)], [], "all", NOW);
    expect(w.points.map((p) => p.price)).toEqual([1, 2, 3]);
  });
});

describe("priceDomain", () => {
  it("pads around the data and stays non-negative", () => {
    const d = priceDomain([pt(2, 100), pt(1, 200)], []);
    expect(d.lo).toBeLessThan(100);
    expect(d.hi).toBeGreaterThan(200);
    expect(d.lo).toBeGreaterThanOrEqual(0);
  });

  it("includes trade prices so dots are never off-chart", () => {
    const d = priceDomain([pt(2, 100), pt(1, 110)], [trade(1, "buy", 300)]);
    expect(d.hi).toBeGreaterThan(300);
  });

  it("is never degenerate for a flat series", () => {
    const d = priceDomain([pt(2, 100), pt(1, 100)], []);
    expect(d.hi).toBeGreaterThan(d.lo);
  });

  it("handles no data", () => {
    expect(priceDomain([], [])).toEqual({ lo: 0, hi: 1 });
  });
});

describe("changeOver", () => {
  it("is last / first − 1", () => {
    expect(changeOver([pt(2, 100), pt(1, 125)])).toBeCloseTo(0.25);
    expect(changeOver([pt(2, 100), pt(1, 80)])).toBeCloseTo(-0.2);
  });

  it("is null with fewer than two points or a zero start", () => {
    expect(changeOver([])).toBeNull();
    expect(changeOver([pt(1, 100)])).toBeNull();
    expect(changeOver([pt(2, 0), pt(1, 10)])).toBeNull();
  });
});

describe("nearestIndex", () => {
  it("finds the closest point in time", () => {
    const s = [pt(10, 1), pt(5, 2), pt(1, 3)];
    expect(nearestIndex(s, NOW - 6 * DAY)).toBe(1);
    expect(nearestIndex(s, NOW)).toBe(2);
    expect(nearestIndex(s, NOW - 99 * DAY)).toBe(0);
  });

  it("is -1 for an empty series", () => {
    expect(nearestIndex([], NOW)).toBe(-1);
  });
});

describe("formatDay", () => {
  it("is fixed-format and UTC", () => {
    expect(formatDay(Date.UTC(2026, 10, 3))).toBe("3 Nov '26");
    expect(formatDay(Date.UTC(2027, 0, 31, 23, 59))).toBe("31 Jan '27");
  });
});
