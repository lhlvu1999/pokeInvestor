import { describe, expect, it } from "vitest";
import {
  changeOverDays,
  latestPrice,
  priceAsOf,
  seriesBounds,
  sortAscending,
  type PricePoint,
} from "./price_history";

const d = (iso: string) => new Date(iso);
const pt = (iso: string, cents: number): PricePoint => ({
  fetchedAt: d(iso),
  priceCents: cents,
});

// A deliberately out-of-order series with an irregular cadence — which is
// what the real table looks like, since prices only land when refreshed.
const series: PricePoint[] = [
  pt("2026-03-01T00:00:00Z", 10_000),
  pt("2026-01-01T00:00:00Z", 8_000),
  pt("2026-02-01T00:00:00Z", 9_000),
  pt("2026-05-01T00:00:00Z", 12_000),
];

describe("sortAscending", () => {
  it("orders by time without mutating the input", () => {
    const before = [...series];
    const sorted = sortAscending(series);
    expect(sorted.map((p) => p.priceCents)).toEqual([
      8_000, 9_000, 10_000, 12_000,
    ]);
    expect(series).toEqual(before);
  });
});

describe("latestPrice", () => {
  it("returns the most recent point regardless of input order", () => {
    expect(latestPrice(series)?.priceCents).toBe(12_000);
  });

  it("returns null for an empty series", () => {
    expect(latestPrice([])).toBeNull();
  });
});

describe("priceAsOf", () => {
  it("carries the last observation forward", () => {
    // Nothing on 2026-02-15; the 2026-02-01 snapshot still applies.
    expect(priceAsOf(series, d("2026-02-15T00:00:00Z"))?.priceCents).toBe(
      9_000,
    );
  });

  it("returns the exact point when one lands on the date", () => {
    expect(priceAsOf(series, d("2026-03-01T00:00:00Z"))?.priceCents).toBe(
      10_000,
    );
  });

  it("returns null before the series starts", () => {
    // Not 'zero' — we simply weren't tracking the item yet.
    expect(priceAsOf(series, d("2025-12-01T00:00:00Z"))).toBeNull();
  });
});

describe("changeOverDays", () => {
  it("computes percentage change over the window", () => {
    // Latest is 2026-05-01 @ 12000. 90d back is ~2026-01-31, which
    // carries forward the 2026-01-01 snapshot @ 8000.
    const c = changeOverDays(series, 90)!;
    expect(c.currentCents).toBe(12_000);
    expect(c.priorCents).toBe(8_000);
    expect(c.changePct).toBeCloseTo(0.5, 5);
  });

  it("reports a negative change when the price fell", () => {
    const falling = [
      pt("2026-01-01T00:00:00Z", 20_000),
      pt("2026-02-01T00:00:00Z", 15_000),
    ];
    const c = changeOverDays(falling, 30)!;
    expect(c.changePct).toBeCloseTo(-0.25, 5);
  });

  it("falls back to the oldest point when the window predates the series", () => {
    // Only ~2 days of history but a 90d window requested. Rather than
    // giving up we compare against the oldest snapshot and report the
    // real span, so the UI can say "over 2d" instead of implying 90d.
    const young = [
      pt("2026-05-01T00:00:00Z", 10_000),
      pt("2026-05-03T00:00:00Z", 11_000),
    ];
    const c = changeOverDays(young, 90)!;
    expect(c.priorCents).toBe(10_000);
    expect(c.changePct).toBeCloseTo(0.1, 5);
    expect(c.spanDays).toBeCloseTo(2, 5);
  });

  it("returns null with only one snapshot", () => {
    expect(changeOverDays([pt("2026-05-01T00:00:00Z", 10_000)], 30)).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(changeOverDays([], 30)).toBeNull();
  });

  it("returns null when the prior price is zero (avoids infinite %)", () => {
    const zeroed = [
      pt("2026-01-01T00:00:00Z", 0),
      pt("2026-02-01T00:00:00Z", 5_000),
    ];
    expect(changeOverDays(zeroed, 30)).toBeNull();
  });

  it("reports the true span when snapshots are sparser than the window", () => {
    const sparse = [
      pt("2026-01-01T00:00:00Z", 10_000),
      pt("2026-06-01T00:00:00Z", 12_000),
    ];
    // Asked for 30d, but the only prior observation is ~151d back.
    const c = changeOverDays(sparse, 30)!;
    expect(c.spanDays).toBeGreaterThan(100);
  });
});

describe("seriesBounds", () => {
  it("reports min/max/first/last/count", () => {
    const b = seriesBounds(series)!;
    expect(b).toEqual({
      minCents: 8_000,
      maxCents: 12_000,
      firstCents: 8_000,
      lastCents: 12_000,
      count: 4,
    });
  });

  it("returns null for an empty series", () => {
    expect(seriesBounds([])).toBeNull();
  });

  it("handles a single point", () => {
    const b = seriesBounds([pt("2026-01-01T00:00:00Z", 500)])!;
    expect(b.minCents).toBe(500);
    expect(b.maxCents).toBe(500);
    expect(b.count).toBe(1);
  });
});
