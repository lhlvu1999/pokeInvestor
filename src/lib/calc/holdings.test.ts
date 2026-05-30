import { describe, expect, it } from "vitest";
import {
  EMPTY_HOLDINGS,
  InsufficientHoldingsError,
  MixedCurrencyError,
  computeHoldings,
  valueHoldings,
} from "./holdings";

type TxInput = {
  type: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  occurredAt: Date;
  currency: string;
  lotId: string | null;
  status: "pending" | "received";
  shippingCents: number | null;
};

const t = (iso: string) => new Date(iso);

function tx(
  partial: Omit<TxInput, "currency" | "lotId" | "status" | "shippingCents"> & {
    currency?: string;
    lotId?: string | null;
    status?: "pending" | "received";
    shippingCents?: number | null;
  },
): TxInput {
  return {
    currency: "USD",
    lotId: null,
    status: "received",
    shippingCents: null,
    ...partial,
  };
}

describe("computeHoldings — empty / basics", () => {
  it("returns empty snapshot for no transactions", () => {
    expect(computeHoldings([])).toEqual(EMPTY_HOLDINGS);
  });

  it("rejects non-positive quantities", () => {
    expect(() =>
      computeHoldings([
        tx({
          type: "buy",
          quantity: 0,
          finalValueCents: 100,
          occurredAt: t("2026-01-01"),
        }),
      ]),
    ).toThrow();
  });

  it("rejects mixed currencies", () => {
    expect(() =>
      computeHoldings([
        tx({
          type: "buy",
          quantity: 1,
          finalValueCents: 10_000,
          occurredAt: t("2026-01-01"),
          currency: "USD",
        }),
        tx({
          type: "buy",
          quantity: 1,
          finalValueCents: 25_000,
          occurredAt: t("2026-01-02"),
          currency: "VND",
        }),
      ]),
    ).toThrow(MixedCurrencyError);
  });
});

describe("computeHoldings — null-lot (FIFO)", () => {
  it("handles a single buy", () => {
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 2,
        finalValueCents: 20_000,
        occurredAt: t("2026-01-01"),
      }),
    ]);
    expect(snap.quantity).toBe(2);
    expect(snap.avgCostCents).toBe(10_000);
    expect(snap.realizedProfitCents).toBe(0);
  });

  it("FIFO: partial sell consumes oldest buy first", () => {
    // Buy 2 @ 10k each, then 3 @ 12k each, then sell 2.
    // FIFO consumes the 2 oldest (@10k each = 20k cost basis).
    // realized = 30k - 20k = 10k. Held = 3 @ 12k each.
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 2,
        finalValueCents: 20_000,
        occurredAt: t("2026-01-01"),
      }),
      tx({
        type: "buy",
        quantity: 3,
        finalValueCents: 36_000,
        occurredAt: t("2026-01-02"),
      }),
      tx({
        type: "sell",
        quantity: 2,
        finalValueCents: 30_000,
        occurredAt: t("2026-01-03"),
      }),
    ]);
    expect(snap.quantity).toBe(3);
    expect(snap.avgCostCents).toBe(12_000);
    expect(snap.realizedProfitCents).toBe(10_000);
    expect(snap.soldQuantity).toBe(2);
  });

  it("FIFO: partial-quantity consumption inside a single buy lot", () => {
    // Single buy of 5 @ 100 cents each (500 total), sell 2.
    // FIFO consumes 2/5 of the lot proportionally → consumed = 200.
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 5,
        finalValueCents: 500,
        occurredAt: t("2026-01-01"),
      }),
      tx({
        type: "sell",
        quantity: 2,
        finalValueCents: 300,
        occurredAt: t("2026-01-02"),
      }),
    ]);
    expect(snap.quantity).toBe(3);
    expect(snap.avgCostCents).toBe(100);
    expect(snap.realizedProfitCents).toBe(100);
  });

  it("throws InsufficientHoldingsError when selling more than held", () => {
    expect(() =>
      computeHoldings([
        tx({
          type: "buy",
          quantity: 1,
          finalValueCents: 10_000,
          occurredAt: t("2026-01-01"),
        }),
        tx({
          type: "sell",
          quantity: 2,
          finalValueCents: 30_000,
          occurredAt: t("2026-01-02"),
        }),
      ]),
    ).toThrow(InsufficientHoldingsError);
  });

  it("resets when holdings hit zero, then re-buy", () => {
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 10_000,
        occurredAt: t("2026-01-01"),
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 20_000,
        occurredAt: t("2026-01-02"),
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 5_000,
        occurredAt: t("2026-01-03"),
      }),
    ]);
    expect(snap.quantity).toBe(1);
    expect(snap.avgCostCents).toBe(5_000);
    expect(snap.realizedProfitCents).toBe(10_000);
  });
});

describe("computeHoldings — specific-lot accounting", () => {
  it("matched lot: realized = sell − buy exactly", () => {
    // One CSV row: buy 1 @ 2300, sell 1 @ 2750 → realized 450.
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2300,
        occurredAt: t("2025-09-23"),
        lotId: "lot-A",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 2750,
        occurredAt: t("2026-04-09"),
        lotId: "lot-A",
      }),
    ]);
    expect(snap.quantity).toBe(0);
    expect(snap.realizedProfitCents).toBe(450);
    expect(snap.soldQuantity).toBe(1);
  });

  it("open lot (buy only) contributes to held inventory", () => {
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2200,
        occurredAt: t("2025-09-23"),
        lotId: "lot-B",
      }),
    ]);
    expect(snap.quantity).toBe(1);
    expect(snap.avgCostCents).toBe(2200);
    expect(snap.realizedProfitCents).toBe(0);
  });

  it("multiple lots: realized = sum of paired lots only", () => {
    // Lot A: buy 1@2300 → sell 1@2750 (+450)
    // Lot B: buy 1@2100 → sell 1@0    (-2100)
    // Lot C: buy 1@2200 (held)
    // Total realized 450 - 2100 = -1650; held 1 @ 2200.
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2300,
        occurredAt: t("2025-09-23"),
        lotId: "A",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2200,
        occurredAt: t("2025-09-23"),
        lotId: "C",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2100,
        occurredAt: t("2025-11-19"),
        lotId: "B",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 0,
        occurredAt: t("2026-02-12"),
        lotId: "B",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 2750,
        occurredAt: t("2026-04-09"),
        lotId: "A",
      }),
    ]);
    expect(snap.quantity).toBe(1);
    expect(snap.realizedProfitCents).toBe(-1650);
    expect(snap.avgCostCents).toBe(2200);
    expect(snap.totalBoughtCents).toBe(6600);
    expect(snap.totalSoldCents).toBe(2750);
  });

  it("partial-quantity lot: realized scales proportionally", () => {
    // Lot of buy 5 @ 500 cents total (100/unit). Sell 2 → 200 cost.
    // Sell @300 → realized 100. Held = 3 @ 100/unit, 300 cost.
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 5,
        finalValueCents: 500,
        occurredAt: t("2026-01-01"),
        lotId: "A",
      }),
      tx({
        type: "sell",
        quantity: 2,
        finalValueCents: 300,
        occurredAt: t("2026-01-10"),
        lotId: "A",
      }),
    ]);
    expect(snap.quantity).toBe(3);
    expect(snap.avgCostCents).toBe(100);
    expect(snap.realizedProfitCents).toBe(100);
  });

  it("lot oversell rejects", () => {
    expect(() =>
      computeHoldings([
        tx({
          type: "buy",
          quantity: 1,
          finalValueCents: 100,
          occurredAt: t("2026-01-01"),
          lotId: "X",
        }),
        tx({
          type: "sell",
          quantity: 2,
          finalValueCents: 300,
          occurredAt: t("2026-01-02"),
          lotId: "X",
        }),
      ]),
    ).toThrow(InsufficientHoldingsError);
  });

  it("matches the CSV-row spreadsheet view exactly", () => {
    // Reproducing user's `etb destined rivals` data — every row is its own lot.
    // 5 sells, 1 still held; spreadsheet says realized = 13_955 (in thousands),
    // total spent = 16_650 = 4*2625 + 2*2760 + the held 2625 = 16650? Let me check.
    // Held: 1 row at 2625; sold: 4 lots @ 2625, 2 lots @ 2760. Total bought: 5*2625 + 2*2760 = 18645
    const lots: TxInput[] = [
      // Lot 1: held
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2625,
        occurredAt: t("2025-10-14T09:00:00Z"),
        lotId: "lot-held",
      }),
      // Lots that sold
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2625,
        occurredAt: t("2025-10-14T09:00:00Z"),
        lotId: "lot-1",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 4300,
        occurredAt: t("2026-03-01T17:00:00Z"),
        lotId: "lot-1",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2625,
        occurredAt: t("2025-10-14T09:00:00Z"),
        lotId: "lot-2",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 5550,
        occurredAt: t("2026-04-05T17:00:00Z"),
        lotId: "lot-2",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2625,
        occurredAt: t("2025-10-14T09:00:00Z"),
        lotId: "lot-3",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 5500,
        occurredAt: t("2026-04-09T17:00:00Z"),
        lotId: "lot-3",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2760,
        occurredAt: t("2025-10-20T09:00:00Z"),
        lotId: "lot-4",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 6000,
        occurredAt: t("2026-04-26T17:00:00Z"),
        lotId: "lot-4",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 2760,
        occurredAt: t("2025-10-20T09:00:00Z"),
        lotId: "lot-5",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 6000,
        occurredAt: t("2026-04-26T17:00:00Z"),
        lotId: "lot-5",
      }),
    ];
    const snap = computeHoldings(lots);
    // Per-row pair: 1675 + 2925 + 2875 + 3240 + 3240 = 13_955
    expect(snap.realizedProfitCents).toBe(13_955);
    expect(snap.quantity).toBe(1);
    expect(snap.avgCostCents).toBe(2625);
    expect(snap.soldQuantity).toBe(5);
    // 4 buys @2625 (held + 3 sold) + 2 buys @2760 = 16,020
    expect(snap.totalBoughtCents).toBe(16_020);
    expect(snap.totalSoldCents).toBe(27_350);
  });
});

describe("computeHoldings — manual sell drawing from open-lot inventory", () => {
  it("null-lot sell can consume from an open lot's leftover units", () => {
    // Mirrors the user's "slab raichu 8" scenario:
    // Imported as a single open lot (buy only, lot_id = A, held = 1).
    // User adds a manual sell (lot_id = null, qty = 1, value = 800_000).
    // Should succeed: queue starts with lot-A's 1 unit; null-lot sell
    // consumes FIFO across any inventory, so it draws from lot A.
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 500_000,
        occurredAt: t("2025-09-23"),
        lotId: "A",
        currency: "VND",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 800_000,
        occurredAt: t("2026-05-18"),
        lotId: null,
        currency: "VND",
      }),
    ]);
    expect(snap.quantity).toBe(0);
    expect(snap.soldQuantity).toBe(1);
    expect(snap.realizedProfitCents).toBe(300_000); // 800_000 - 500_000
  });

  it("lot-specific sell still consumes only from its own lot, not free buys", () => {
    // Open lot A with 1 unit; a free buy of 1 unit at a different price;
    // a lot-A sell should consume from A, not from the free buy.
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 1000,
        occurredAt: t("2026-01-01"),
        lotId: "A",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 500,
        occurredAt: t("2026-02-01"),
        lotId: null,
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 1500,
        occurredAt: t("2026-03-01"),
        lotId: "A",
      }),
    ]);
    // Lot-A sell consumed lot-A's 1000 → realized = 1500 - 1000 = 500.
    // The free buy (500) is still held.
    expect(snap.realizedProfitCents).toBe(500);
    expect(snap.quantity).toBe(1);
    expect(snap.avgCostCents).toBe(500);
  });

  it("rejects when null-lot sell exceeds total available inventory", () => {
    expect(() =>
      computeHoldings([
        tx({
          type: "buy",
          quantity: 1,
          finalValueCents: 1000,
          occurredAt: t("2026-01-01"),
          lotId: "A",
        }),
        tx({
          type: "sell",
          quantity: 2,
          finalValueCents: 3000,
          occurredAt: t("2026-02-01"),
          lotId: null,
        }),
      ]),
    ).toThrow(InsufficientHoldingsError);
  });
});

describe("computeHoldings — combined lot + free", () => {
  it("aggregates explicit lots and FIFO-free transactions", () => {
    // One paired lot (buy 1@100, sell 1@150) → realized +50.
    // Plus a free buy 1@200 (still held).
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 100,
        occurredAt: t("2026-01-01"),
        lotId: "L",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 150,
        occurredAt: t("2026-02-01"),
        lotId: "L",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 200,
        occurredAt: t("2026-03-01"),
      }),
    ]);
    expect(snap.realizedProfitCents).toBe(50);
    expect(snap.quantity).toBe(1);
    expect(snap.avgCostCents).toBe(200);
    expect(snap.totalBoughtCents).toBe(300);
    expect(snap.totalSoldCents).toBe(150);
  });
});

describe("computeHoldings — pending status", () => {
  it("pending buys count toward totalBought + pendingQty but not held", () => {
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 2,
        finalValueCents: 1000,
        occurredAt: t("2026-01-01"),
        status: "pending",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 600,
        occurredAt: t("2026-02-01"),
        status: "received",
      }),
    ]);
    expect(snap.quantity).toBe(1); // only the received buy
    expect(snap.pendingQuantity).toBe(2);
    expect(snap.pendingCostCents).toBe(1000);
    expect(snap.totalBoughtCents).toBe(1600); // both buys
  });

  it("sells cannot consume pending inventory", () => {
    expect(() =>
      computeHoldings([
        tx({
          type: "buy",
          quantity: 1,
          finalValueCents: 100,
          occurredAt: t("2026-01-01"),
          status: "pending",
        }),
        tx({
          type: "sell",
          quantity: 1,
          finalValueCents: 200,
          occurredAt: t("2026-02-01"),
        }),
      ]),
    ).toThrow(InsufficientHoldingsError);
  });

  it("sells consume normally once buy is marked received", () => {
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 100,
        occurredAt: t("2026-01-01"),
        status: "received",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 200,
        occurredAt: t("2026-02-01"),
      }),
    ]);
    expect(snap.quantity).toBe(0);
    expect(snap.realizedProfitCents).toBe(100);
  });
});

describe("computeHoldings — shipping totals", () => {
  it("sums shipping across all buys/sells", () => {
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 500,
        shippingCents: 50,
        occurredAt: t("2026-01-01"),
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 700,
        shippingCents: 80,
        occurredAt: t("2026-02-01"),
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 300,
        shippingCents: null,
        occurredAt: t("2026-03-01"),
      }),
    ]);
    expect(snap.totalShippingCents).toBe(130);
  });
});

describe("valueHoldings", () => {
  it("zeros out market-related fields when no market price", () => {
    const snap = computeHoldings([
      tx({
        type: "buy",
        quantity: 3,
        finalValueCents: 33_600,
        occurredAt: t("2026-01-01"),
      }),
    ]);
    const v = valueHoldings(snap, null);
    expect(v.marketPriceCents).toBeNull();
    expect(v.marketValueCents).toBe(0);
    expect(v.unrealizedProfitCents).toBe(0);
    expect(v.totalProfitCents).toBe(0);
    expect(v.inventoryCostCents).toBe(33_600);
  });
});
