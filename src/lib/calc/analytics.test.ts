import { describe, expect, it } from "vitest";
import {
  DAYS_HELD_EDGES,
  DAYS_HELD_LABELS,
  MARGIN_PCT_EDGES,
  MARGIN_PCT_LABELS,
  makeHistogram,
  replayForAnalytics,
} from "./analytics";

const t = (iso: string) => new Date(iso);

type TxInput = Parameters<typeof replayForAnalytics>[0][number];

function tx(
  partial: Omit<TxInput, "id" | "currency" | "lotId" | "status"> & {
    id?: string;
    currency?: string;
    lotId?: string | null;
    status?: "pending" | "received";
  },
): TxInput {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    currency: "USD",
    lotId: null,
    status: "received",
    ...partial,
  };
}

describe("replayForAnalytics", () => {
  it("emits a sell record with realized + margin + days-held", () => {
    const { sells, remaining } = replayForAnalytics([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 100,
        occurredAt: t("2026-01-01T09:00:00Z"),
        lotId: "L",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 150,
        occurredAt: t("2026-02-01T17:00:00Z"),
        lotId: "L",
      }),
    ]);
    expect(sells).toHaveLength(1);
    expect(sells[0].consumedCostCents).toBe(100);
    expect(sells[0].realizedCents).toBe(50);
    expect(sells[0].marginPct).toBeCloseTo(50);
    expect(sells[0].daysHeldAvg).toBeGreaterThan(30);
    expect(sells[0].daysHeldAvg).toBeLessThan(32);
    expect(remaining).toHaveLength(0);
  });

  it("excludes pending buys from inventory; sell can't consume them", () => {
    const { sells, remaining } = replayForAnalytics([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 100,
        occurredAt: t("2026-01-01"),
        status: "pending",
      }),
    ]);
    expect(sells).toHaveLength(0);
    expect(remaining).toHaveLength(0); // pending buys never enter the queue
  });

  it("weights days-held across multi-buy FIFO consumption", () => {
    const { sells } = replayForAnalytics([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 100,
        occurredAt: t("2026-01-01"),
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 200,
        occurredAt: t("2026-02-01"),
      }),
      tx({
        type: "sell",
        quantity: 2,
        finalValueCents: 400,
        occurredAt: t("2026-04-01"),
      }),
    ]);
    expect(sells).toHaveLength(1);
    expect(sells[0].consumedCostCents).toBe(300);
    expect(sells[0].realizedCents).toBe(100);
    // Weighted avg of 90d + 59d ≈ 74.5d (with some tz fudge — just bounds)
    expect(sells[0].daysHeldAvg).toBeGreaterThan(50);
    expect(sells[0].daysHeldAvg).toBeLessThan(100);
  });

  it("returns remaining inventory for unsold buys", () => {
    const { remaining } = replayForAnalytics([
      tx({
        type: "buy",
        quantity: 2,
        finalValueCents: 500,
        occurredAt: t("2026-01-01"),
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 300,
        occurredAt: t("2026-02-01"),
      }),
    ]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].qty).toBe(1);
    expect(remaining[0].cost).toBe(250); // half of 500
  });
});

describe("makeHistogram", () => {
  it("buckets values into the right ranges", () => {
    const buckets = makeHistogram(
      [3, 10, 45, 100, 200, 500],
      DAYS_HELD_EDGES,
      DAYS_HELD_LABELS,
    );
    // 3 → 0–7d, 10 → 7–30d, 45 → 30–90d, 100 → 90–180d, 200 → 180–365d, 500 → 365d+
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("handles negative-infinity edges for margin histograms", () => {
    const buckets = makeHistogram(
      [-80, -10, 5, 30, 75, 150],
      MARGIN_PCT_EDGES,
      MARGIN_PCT_LABELS,
    );
    expect(buckets.map((b) => b.count)).toEqual([1, 0, 1, 1, 1, 1, 1]);
  });

  it("rejects mismatched edges/labels", () => {
    expect(() => makeHistogram([1], [0, 10], ["x", "y"])).toThrow();
  });
});
