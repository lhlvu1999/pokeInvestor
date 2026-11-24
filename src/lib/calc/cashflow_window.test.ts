import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildMonthSeries,
  capMagnitude,
  currentMonthKey,
  formatMonthLong,
  formatMonthShort,
  isMonthKey,
  monthsBetween,
  niceDomain,
  parseRangeParams,
  rangeToParams,
  resolveWindow,
  topPurchases,
  topSales,
  totalsOf,
  type WindowLine,
} from "./cashflow_window";

const line = (o: Partial<WindowLine> & Pick<WindowLine, "month" | "itemId">) =>
  ({
    itemName: o.itemId.toUpperCase(),
    spend: 0,
    revenue: 0,
    realized: 0,
    shipping: 0,
    buys: 0,
    sells: 0,
    unitsBought: 0,
    unitsSold: 0,
    ...o,
  }) satisfies WindowLine;

describe("month keys", () => {
  it("validates", () => {
    expect(isMonthKey("2026-04")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-4")).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
    expect(isMonthKey("2026-04-01")).toBe(false);
  });

  it("adds months across year boundaries in both directions", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-01", -13)).toBe("2024-12");
    expect(addMonths("2026-06", 0)).toBe("2026-06");
  });

  it("lists months inclusively, and is empty when reversed", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(monthsBetween("2026-02", "2026-02")).toEqual(["2026-02"]);
    expect(monthsBetween("2026-03", "2026-02")).toEqual([]);
  });

  it("formats with fixed English names", () => {
    expect(formatMonthShort("2026-04")).toBe("Apr '26");
    expect(formatMonthLong("2026-12")).toBe("December 2026");
  });

  it("uses UTC for the current month", () => {
    expect(currentMonthKey(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11");
    expect(currentMonthKey(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
  });
});

describe("range params", () => {
  it("defaults to 6m and falls back on junk", () => {
    expect(parseRangeParams({})).toEqual({ kind: "6m" });
    expect(parseRangeParams({ cf: "banana" })).toEqual({ kind: "6m" });
    expect(
      parseRangeParams({ cf: "custom", cffrom: "nope", cfto: "2026-01" }),
    ).toEqual({ kind: "6m" });
  });

  it("parses presets and custom ranges, swapping reversed bounds", () => {
    expect(parseRangeParams({ cf: "all" })).toEqual({ kind: "all" });
    expect(
      parseRangeParams({ cf: "custom", cffrom: "2026-03", cfto: "2026-05" }),
    ).toEqual({ kind: "custom", from: "2026-03", to: "2026-05" });
    expect(
      parseRangeParams({ cf: "custom", cffrom: "2026-05", cfto: "2026-03" }),
    ).toEqual({ kind: "custom", from: "2026-03", to: "2026-05" });
  });

  it("round-trips, omitting the default", () => {
    expect(rangeToParams({ kind: "6m" })).toEqual({});
    expect(rangeToParams({ kind: "12m" })).toEqual({ cf: "12m" });
    const custom = { kind: "custom", from: "2026-01", to: "2026-02" } as const;
    expect(parseRangeParams(rangeToParams(custom))).toEqual(custom);
  });
});

describe("resolveWindow", () => {
  const bounds = { first: "2025-09", last: "2026-04" };

  it("ends at the current month even when it has no activity", () => {
    expect(resolveWindow({ kind: "3m" }, bounds, "2026-11")).toEqual({
      from: "2026-09",
      to: "2026-11",
    });
  });

  it("does not start before the first transaction", () => {
    expect(resolveWindow({ kind: "12m" }, bounds, "2026-04")).toEqual({
      from: "2025-09",
      to: "2026-04",
    });
    expect(resolveWindow({ kind: "all" }, bounds, "2026-11")).toEqual({
      from: "2025-09",
      to: "2026-11",
    });
  });

  it("extends to later data if the clock is behind", () => {
    expect(resolveWindow({ kind: "3m" }, bounds, "2026-01")).toEqual({
      from: "2026-02",
      to: "2026-04",
    });
  });

  it("clamps custom ranges to what exists", () => {
    expect(
      resolveWindow(
        { kind: "custom", from: "2020-01", to: "2030-01" },
        bounds,
        "2026-11",
      ),
    ).toEqual({ from: "2025-09", to: "2026-11" });
  });

  it("never returns an inverted window", () => {
    const w = resolveWindow(
      { kind: "custom", from: "2031-01", to: "2032-01" },
      bounds,
      "2026-11",
    );
    expect(w.from <= w.to).toBe(true);
  });
});

describe("series and totals", () => {
  const lines = [
    line({
      month: "2026-01",
      itemId: "a",
      spend: 100,
      buys: 1,
      unitsBought: 2,
      shipping: 10,
    }),
    line({ month: "2026-01", itemId: "b", spend: 50, buys: 1, unitsBought: 1 }),
    line({
      month: "2026-03",
      itemId: "a",
      revenue: 300,
      realized: 120,
      sells: 1,
      unitsSold: 2,
    }),
    line({ month: "2026-09", itemId: "a", spend: 999 }), // outside window
  ];

  it("zero-fills quiet months and ignores lines outside the window", () => {
    const months = monthsBetween("2026-01", "2026-04");
    const s = buildMonthSeries(lines, months);
    expect(s.map((m) => m.month)).toEqual(months);
    expect(s[0]).toMatchObject({
      spend: 150,
      net: -150,
      buys: 2,
      unitsBought: 3,
      shipping: 10,
    });
    expect(s[1]).toMatchObject({ spend: 0, revenue: 0, net: 0 });
    expect(s[2]).toMatchObject({
      revenue: 300,
      net: 300,
      realized: 120,
      sells: 1,
    });
    expect(s[3].spend).toBe(0);
  });

  it("totals equal the sum of the visible months", () => {
    const s = buildMonthSeries(lines, monthsBetween("2026-01", "2026-04"));
    expect(totalsOf(s)).toMatchObject({
      spend: 150,
      revenue: 300,
      net: 150,
      realized: 120,
      buys: 2,
      sells: 1,
      unitsBought: 3,
      unitsSold: 2,
    });
  });
});

describe("item rollups", () => {
  const lines = [
    line({ month: "2026-01", itemId: "a", spend: 100, unitsBought: 1 }),
    line({ month: "2026-02", itemId: "a", spend: 200, unitsBought: 2 }),
    line({ month: "2026-02", itemId: "b", spend: 250, unitsBought: 1 }),
    line({
      month: "2026-02",
      itemId: "c",
      revenue: 400,
      unitsSold: 3,
      realized: 90,
    }),
    line({ month: "2026-05", itemId: "a", spend: 9_999 }),
  ];

  it("ranks purchases by spend within the selected months", () => {
    const top = topPurchases(lines, new Set(["2026-01", "2026-02"]), 10);
    expect(top.map((r) => [r.itemId, r.amount, r.units])).toEqual([
      ["a", 300, 3],
      ["b", 250, 1],
    ]);
  });

  it("ranks sales by revenue and limits to n", () => {
    const sales = topSales(lines, new Set(["2026-02"]), 1);
    expect(sales).toEqual([
      { itemId: "c", itemName: "C", amount: 400, units: 3, realized: 90 },
    ]);
    expect(topPurchases(lines, new Set(["2026-02"]), 1)).toHaveLength(1);
  });

  it("is empty for a window with no activity", () => {
    expect(topPurchases(lines, new Set(["2030-01"]), 5)).toEqual([]);
  });
});

describe("capMagnitude", () => {
  it("leaves a normal spread alone", () => {
    expect(capMagnitude([10, 20, 30, 40])).toEqual({ max: 40, capped: false });
  });

  it("caps one dominant outlier just above the runner-up", () => {
    const r = capMagnitude([20, 30, 90, 770]);
    expect(r.capped).toBe(true);
    expect(r.max).toBeGreaterThan(90);
    expect(r.max).toBeLessThan(120);
  });

  it("does not cap when two months are both huge", () => {
    expect(capMagnitude([20, 700, 770]).capped).toBe(false);
  });

  it("needs at least three non-zero values", () => {
    expect(capMagnitude([5, 500])).toEqual({ max: 500, capped: false });
    expect(capMagnitude([0, 0, 500, 5])).toEqual({ max: 500, capped: false });
    expect(capMagnitude([])).toEqual({ max: 0, capped: false });
  });
});

describe("niceDomain", () => {
  it("rounds out to clean ticks that include zero", () => {
    const d = niceDomain(93, 41);
    expect(d.hi).toBeGreaterThanOrEqual(93);
    expect(d.lo).toBeLessThanOrEqual(-41);
    expect(d.ticks).toContain(0);
    expect(d.ticks[0]).toBe(d.lo);
    expect(d.ticks[d.ticks.length - 1]).toBe(d.hi);
  });

  it("works with one-sided data", () => {
    const d = niceDomain(80, 0);
    expect(d.lo).toBe(0);
    expect(d.hi).toBeGreaterThanOrEqual(80);
  });

  it("handles no data", () => {
    const d = niceDomain(0, 0);
    expect(d.hi).toBeGreaterThan(d.lo);
  });
});
