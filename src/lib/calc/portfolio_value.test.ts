import { describe, expect, it } from "vitest";
import {
  computePortfolioSnapshots,
  weeklySnapshotDates,
} from "./portfolio_value";

const d = (iso: string) => new Date(iso);

const buy = (opts: {
  qty: number;
  cents: number;
  at: string;
  currency?: string;
  status?: "received" | "pending";
}) => ({
  type: "buy" as const,
  quantity: opts.qty,
  finalValueCents: opts.cents,
  occurredAt: d(opts.at),
  currency: opts.currency ?? "USD",
  lotId: null,
  status: opts.status ?? ("received" as const),
  shippingCents: null,
});

const sell = (opts: {
  qty: number;
  cents: number;
  at: string;
  currency?: string;
}) => ({
  type: "sell" as const,
  quantity: opts.qty,
  finalValueCents: opts.cents,
  occurredAt: d(opts.at),
  currency: opts.currency ?? "USD",
  lotId: null,
  status: "received" as const,
  shippingCents: null,
});

const price = (opts: { cents: number; at: string; currency?: string }) => ({
  priceCents: opts.cents,
  currency: opts.currency ?? "USD",
  fetchedAt: d(opts.at),
});

describe("computePortfolioSnapshots", () => {
  it("returns one bucket per currency held at the snapshot date", () => {
    const dates = [d("2026-06-01T00:00:00Z")];
    const txs = new Map([
      ["a", [buy({ qty: 2, cents: 20_000, at: "2026-01-01T00:00:00Z" })]],
      [
        "b",
        [
          buy({
            qty: 1,
            cents: 500_000,
            at: "2026-02-01T00:00:00Z",
            currency: "VND",
          }),
        ],
      ],
    ]);
    const currencies = new Map([
      ["a", "USD"],
      ["b", "VND"],
    ]);
    const [snap] = computePortfolioSnapshots(dates, txs, new Map(), currencies);
    expect(snap.buckets).toHaveLength(2);
    expect(snap.itemsHeld).toBe(2);
    const usd = snap.buckets.find((b) => b.currency === "USD")!;
    expect(usd.costBasis).toBe(20_000);
    expect(usd.marketValue).toBeNull(); // no price data
    const vnd = snap.buckets.find((b) => b.currency === "VND")!;
    expect(vnd.costBasis).toBe(500_000);
  });

  it("ignores items with no transactions on/before the snapshot date", () => {
    const dates = [d("2026-01-10T00:00:00Z")];
    const txs = new Map([
      ["future", [buy({ qty: 1, cents: 10_000, at: "2026-06-01T00:00:00Z" })]],
    ]);
    const [snap] = computePortfolioSnapshots(
      dates,
      txs,
      new Map(),
      new Map([["future", "USD"]]),
    );
    expect(snap.buckets).toHaveLength(0);
    expect(snap.itemsHeld).toBe(0);
  });

  it("uses the latest market price on/before the snapshot for marketValue", () => {
    const dates = [d("2026-03-15T00:00:00Z"), d("2026-06-15T00:00:00Z")];
    const txs = new Map([
      ["a", [buy({ qty: 2, cents: 20_000, at: "2026-01-01T00:00:00Z" })]],
    ]);
    const prices = new Map([
      [
        "a",
        [
          price({ cents: 12_000, at: "2026-02-01T00:00:00Z" }),
          price({ cents: 15_000, at: "2026-05-01T00:00:00Z" }),
          price({ cents: 20_000, at: "2026-07-01T00:00:00Z" }), // after snap 2
        ],
      ],
    ]);
    const currencies = new Map([["a", "USD"]]);
    const [snap1, snap2] = computePortfolioSnapshots(
      dates,
      txs,
      prices,
      currencies,
    );
    // Snap 1 (2026-03-15): only Feb price applies → 2 * 12_000
    expect(snap1.buckets[0].marketValue).toBe(24_000);
    expect(snap1.buckets[0].itemsWithPrice).toBe(1);
    // Snap 2 (2026-06-15): May price is latest ≤ date → 2 * 15_000
    expect(snap2.buckets[0].marketValue).toBe(30_000);
  });

  it("returns null marketValue for a currency bucket with zero priced items", () => {
    const dates = [d("2026-01-15T00:00:00Z")];
    const txs = new Map([
      ["a", [buy({ qty: 1, cents: 10_000, at: "2026-01-01T00:00:00Z" })]],
    ]);
    // Only a *future* price exists — nothing on/before the snapshot.
    const prices = new Map([
      ["a", [price({ cents: 20_000, at: "2026-02-01T00:00:00Z" })]],
    ]);
    const [snap] = computePortfolioSnapshots(
      dates,
      txs,
      prices,
      new Map([["a", "USD"]]),
    );
    expect(snap.buckets[0].marketValue).toBeNull();
    expect(snap.buckets[0].itemsWithPrice).toBe(0);
  });

  it("shrinks cost basis after a sell", () => {
    const dates = [d("2026-06-01T00:00:00Z")];
    const txs = new Map([
      [
        "a",
        [
          buy({ qty: 4, cents: 40_000, at: "2026-01-01T00:00:00Z" }),
          sell({ qty: 3, cents: 45_000, at: "2026-02-01T00:00:00Z" }),
        ],
      ],
    ]);
    const [snap] = computePortfolioSnapshots(
      dates,
      txs,
      new Map(),
      new Map([["a", "USD"]]),
    );
    // 1 unit left @ 10_000 avg cost = 10_000 cost basis
    expect(snap.buckets[0].costBasis).toBe(10_000);
  });
});

describe("weeklySnapshotDates", () => {
  it("returns the requested number of weekly dates in ascending order", () => {
    const dates = weeklySnapshotDates(4);
    expect(dates).toHaveLength(4);
    for (let i = 1; i < dates.length; i++) {
      const diffDays =
        (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(7, 5);
    }
  });

  it("last date is on or after today", () => {
    const dates = weeklySnapshotDates(3);
    const last = dates[dates.length - 1];
    expect(last.getTime()).toBeGreaterThanOrEqual(
      Date.now() - 24 * 60 * 60 * 1000,
    );
  });
});
