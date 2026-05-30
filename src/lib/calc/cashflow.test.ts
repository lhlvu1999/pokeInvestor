import { describe, expect, it } from "vitest";
import { groupByMonthCurrency, replayItemEvents } from "./cashflow";

const t = (iso: string) => new Date(iso);

const baseTx = (overrides: {
  type: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  occurredAt: Date;
  currency?: string;
  lotId?: string | null;
  shippingCents?: number | null;
}) => ({
  currency: "USD",
  lotId: null,
  shippingCents: null,
  ...overrides,
});

describe("replayItemEvents — null-lot FIFO", () => {
  it("emits one event per transaction with FIFO realized profit", () => {
    const events = replayItemEvents([
      baseTx({
        type: "buy",
        quantity: 2,
        finalValueCents: 20_000,
        occurredAt: t("2026-01-15T09:00:00Z"),
      }),
      baseTx({
        type: "buy",
        quantity: 3,
        finalValueCents: 36_000,
        occurredAt: t("2026-02-15T09:00:00Z"),
      }),
      baseTx({
        type: "sell",
        quantity: 2,
        finalValueCents: 30_000,
        occurredAt: t("2026-03-01T09:00:00Z"),
      }),
    ]);
    expect(events).toHaveLength(3);
    // FIFO consumes oldest 2 @ 10k each = 20k cost basis → realized = 30k - 20k = 10k.
    expect(events[2].realized).toBe(10_000);
    expect(events[2].month).toBe("2026-03");
  });

  it("handles a loss-on-sale via FIFO", () => {
    const events = replayItemEvents([
      baseTx({
        type: "buy",
        quantity: 1,
        finalValueCents: 1250,
        occurredAt: t("2025-10-19"),
        currency: "VND",
      }),
      baseTx({
        type: "sell",
        quantity: 1,
        finalValueCents: 700,
        occurredAt: t("2026-03-23"),
        currency: "VND",
      }),
    ]);
    expect(events[1].realized).toBe(-550);
  });
});

describe("replayItemEvents — specific-lot accounting", () => {
  it("realized = sell − buy exactly for matched lot", () => {
    const events = replayItemEvents([
      baseTx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2625,
        occurredAt: t("2025-10-14T09:00:00Z"),
        lotId: "L1",
      }),
      baseTx({
        type: "sell",
        quantity: 1,
        finalValueCents: 4300,
        occurredAt: t("2026-03-01T17:00:00Z"),
        lotId: "L1",
      }),
    ]);
    expect(events[1].realized).toBe(1675);
    expect(events[1].month).toBe("2026-03");
  });

  it("realized for two lots paired independently", () => {
    const events = replayItemEvents([
      // Lot A
      baseTx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2625,
        occurredAt: t("2025-10-14T09:00:00Z"),
        lotId: "A",
      }),
      // Lot B (different cost, same item)
      baseTx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2760,
        occurredAt: t("2025-10-20T09:00:00Z"),
        lotId: "B",
      }),
      // Sell B's unit at 6000 → realized 3240, NOT consuming A's cheaper buy
      baseTx({
        type: "sell",
        quantity: 1,
        finalValueCents: 6000,
        occurredAt: t("2026-04-26T17:00:00Z"),
        lotId: "B",
      }),
    ]);
    const sell = events.find((e) => e.revenue > 0);
    expect(sell?.realized).toBe(3240);
  });
});

describe("groupByMonthCurrency", () => {
  it("merges events with the same month + currency", () => {
    const grouped = groupByMonthCurrency([
      { month: "2026-01", spend: 100, revenue: 0, realized: 0, shipping: 10, currency: "USD" },
      { month: "2026-01", spend: 0, revenue: 200, realized: 50, shipping: 0, currency: "USD" },
      { month: "2026-01", spend: 1000, revenue: 0, realized: 0, shipping: 0, currency: "VND" },
    ]);
    expect(grouped).toHaveLength(2);
    const usd = grouped.find((g) => g.currency === "USD")!;
    expect(usd.spend).toBe(100);
    expect(usd.revenue).toBe(200);
    expect(usd.realized).toBe(50);
    expect(usd.shipping).toBe(10);
  });
});
