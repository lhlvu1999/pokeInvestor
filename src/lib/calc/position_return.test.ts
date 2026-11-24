import { describe, expect, it } from "vitest";
import {
  durationLabel,
  fromReport,
  parseBasis,
  periodEntryDay,
  priceReturn,
  purchaseReturn,
  rateText,
} from "./position_return";
import { computeReturn } from "./annualized";

const p = (day: string, cents: number) => ({ day, cents });

describe("priceReturn", () => {
  it("is the compound yearly rate between two prices", () => {
    // Doubled over exactly 365 days → +100% a year, +100% in total.
    const r = priceReturn("launch", p("2025-01-01", 100), p("2026-01-01", 200));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.days).toBe(365);
    expect(r.annualized).toBeCloseTo(1, 12);
    expect(r.change).toBeCloseTo(1, 12);
    expect(r.extrapolated).toBe(false);
    expect(r.entryDay).toBe("2025-01-01");
    expect(r.prices).toEqual({
      entry: p("2025-01-01", 100),
      now: p("2026-01-01", 200),
    });
  });

  it("annualizes a shorter span and flags it as a projection", () => {
    // +21% over 182.5 days (half a year) → 1.21^2 - 1 = 46.41%/yr.
    const r = priceReturn("6m", p("2026-01-01", 100), p("2026-07-02", 121));
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.days).toBe(182);
    expect(r.annualized).toBeCloseTo(Math.pow(1.21, 365 / 182) - 1, 12);
    expect(r.extrapolated).toBe(true);
  });

  it("handles a fall", () => {
    const r = priceReturn("1y", p("2025-01-01", 200), p("2026-01-01", 100));
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.annualized).toBeCloseTo(-0.5, 12);
    expect(r.change).toBeCloseTo(-0.5, 12);
  });

  it("holds back under 90 days and says how long to go", () => {
    const r = priceReturn("launch", p("2026-10-01", 100), p("2026-11-22", 300));
    expect(r).toEqual({
      status: "too_early",
      basis: "launch",
      days: 52,
      daysToGo: 38,
      entryDay: "2026-10-01",
    });
  });

  it("allows exactly 90 days", () => {
    const r = priceReturn("launch", p("2026-01-01", 100), p("2026-04-01", 110));
    expect(r.status).toBe("ok");
  });

  it("says why when a price is missing or unusable", () => {
    expect(priceReturn("launch", null, p("2026-01-01", 1))).toMatchObject({
      status: "unavailable",
      reason: "no_entry_price",
    });
    expect(priceReturn("launch", p("2025-01-01", 1), null)).toMatchObject({
      status: "unavailable",
      reason: "no_current_price",
    });
    expect(
      priceReturn("launch", p("2025-01-01", 0), p("2026-01-01", 5)),
    ).toMatchObject({ status: "unavailable", reason: "no_entry_price" });
  });
});

describe("purchaseReturn", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);

  it("wraps the money-weighted return per position", () => {
    // Spent 100 a year ago, worth 150 now: +50%/yr, +50% total.
    const r = purchaseReturn(
      [{ at: d("2025-01-01"), type: "buy", amount: 100 }],
      150,
      d("2026-01-01"),
    );
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.annualized).toBeCloseTo(0.5, 6);
    expect(r.change).toBeCloseTo(0.5, 12);
    expect(r.entryDay).toBe("2025-01-01");
    expect(r.days).toBe(365);
  });

  it("is held back under 90 days", () => {
    const r = purchaseReturn(
      [{ at: d("2026-11-01"), type: "buy", amount: 100 }],
      500,
      d("2026-11-22"),
    );
    expect(r).toMatchObject({ status: "too_early", daysToGo: 69 });
  });

  it("reports nothing to measure with no activity", () => {
    expect(fromReport(computeReturn([], 0, d("2026-01-01")))).toMatchObject({
      status: "unavailable",
      reason: "no_activity",
    });
  });
});

describe("periodEntryDay", () => {
  it("counts back 182 and 365 days", () => {
    expect(periodEntryDay("1y", "2026-11-22")).toBe("2025-11-22");
    expect(periodEntryDay("6m", "2026-11-22")).toBe("2026-05-24");
  });
  it("crosses a leap day correctly", () => {
    expect(periodEntryDay("1y", "2024-12-31")).toBe("2024-01-01");
  });
});

describe("parseBasis", () => {
  it("reads a valid basis and defaults to purchase", () => {
    expect(parseBasis("launch")).toBe("launch");
    expect(parseBasis("6m")).toBe("6m");
    expect(parseBasis("1y")).toBe("1y");
    expect(parseBasis(undefined)).toBe("purchase");
    expect(parseBasis("2y")).toBe("purchase");
    expect(parseBasis("__proto__")).toBe("purchase");
    expect(parseBasis(["1y", "launch"])).toBe("1y");
  });
});

describe("durationLabel", () => {
  it.each([
    [1, "1 day"],
    [52, "52 days"],
    [60, "2 months"],
    [300, "10 months"],
    [730, "2.0 years"],
    [548, "18 months"],
  ])("%i days is %s", (d, label) => {
    expect(durationLabel(d)).toBe(label);
  });
});

describe("rateText", () => {
  it("formats rates and caps absurd ones", () => {
    expect(rateText(0.4)).toBe("+40.0%");
    expect(rateText(-0.295)).toBe("−29.5%");
    expect(rateText(0)).toBe("0.0%");
    expect(rateText(10)).toBe("+1000.0%");
    expect(rateText(10.01)).toBe("more than +1,000%");
  });
});
