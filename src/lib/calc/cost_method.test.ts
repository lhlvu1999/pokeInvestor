import { describe, expect, it } from "vitest";
import {
  InsufficientHoldingsError,
  computeHoldings,
  consumeQueue,
  isCostMethod,
  type CostMethod,
} from "./holdings";
import { replayItemEvents } from "./cashflow";
import { replayForAnalytics } from "./analytics";

const t = (iso: string) => new Date(iso);

type Tx = Parameters<typeof computeHoldings>[0][number];

function tx(p: {
  type: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  at: string;
  lotId?: string | null;
  status?: "pending" | "received";
}): Tx {
  return {
    type: p.type,
    quantity: p.quantity,
    finalValueCents: p.finalValueCents,
    occurredAt: t(p.at),
    currency: "USD",
    lotId: p.lotId ?? null,
    status: p.status ?? "received",
    shippingCents: null,
  };
}

// 2 @ 100 (200), then 2 @ 200 (400), then sell 2 for 300 each (600).
const twoBuysOneSell: Tx[] = [
  tx({ type: "buy", quantity: 2, finalValueCents: 200, at: "2026-01-01" }),
  tx({ type: "buy", quantity: 2, finalValueCents: 400, at: "2026-02-01" }),
  tx({ type: "sell", quantity: 2, finalValueCents: 600, at: "2026-03-01" }),
];

describe("isCostMethod", () => {
  it("accepts only the two methods", () => {
    expect(isCostMethod("fifo")).toBe(true);
    expect(isCostMethod("average")).toBe(true);
    expect(isCostMethod("lifo")).toBe(false);
    expect(isCostMethod(undefined)).toBe(false);
  });
});

describe("computeHoldings — average cost", () => {
  it("FIFO sells the cheap units first", () => {
    const h = computeHoldings(twoBuysOneSell, "fifo");
    // Sold the two 100-cost units: 600 − 200.
    expect(h.realizedProfitCents).toBe(400);
    expect(h.quantity).toBe(2);
    expect(h.avgCostCents).toBe(200);
  });

  it("average charges every unit the pool average", () => {
    const h = computeHoldings(twoBuysOneSell, "average");
    // Pool: 4 units, 600 cost → 150 each. Sold 2 → cost 300.
    expect(h.realizedProfitCents).toBe(300);
    expect(h.quantity).toBe(2);
    expect(h.avgCostCents).toBe(150);
  });

  it("defaults to FIFO", () => {
    expect(computeHoldings(twoBuysOneSell)).toEqual(
      computeHoldings(twoBuysOneSell, "fifo"),
    );
  });

  it("is a moving average: a later buy re-prices the pool", () => {
    const txs: Tx[] = [
      tx({ type: "buy", quantity: 1, finalValueCents: 100, at: "2026-01-01" }),
      tx({ type: "sell", quantity: 1, finalValueCents: 150, at: "2026-02-01" }),
      tx({ type: "buy", quantity: 1, finalValueCents: 300, at: "2026-03-01" }),
      tx({ type: "buy", quantity: 1, finalValueCents: 500, at: "2026-04-01" }),
      tx({ type: "sell", quantity: 1, finalValueCents: 450, at: "2026-05-01" }),
    ];
    const h = computeHoldings(txs, "average");
    // First sell: 150 − 100 = 50. Then pool is (300+500)/2 = 400 each;
    // second sell: 450 − 400 = 50.
    expect(h.realizedProfitCents).toBe(100);
    expect(h.avgCostCents).toBe(400);
  });

  it("ignores lot ids — a lot sell draws from the whole pool", () => {
    const txs: Tx[] = [
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 100,
        at: "2026-01-01",
        lotId: "a",
      }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 300,
        at: "2026-01-02",
        lotId: "b",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 400,
        at: "2026-02-01",
        lotId: "b",
      }),
    ];
    // FIFO (specific lot "b"): 400 − 300. Average: 400 − 200.
    expect(computeHoldings(txs, "fifo").realizedProfitCents).toBe(100);
    expect(computeHoldings(txs, "average").realizedProfitCents).toBe(200);
  });

  it("still rejects selling more than is held", () => {
    const txs: Tx[] = [
      tx({ type: "buy", quantity: 1, finalValueCents: 100, at: "2026-01-01" }),
      tx({ type: "sell", quantity: 2, finalValueCents: 300, at: "2026-02-01" }),
    ];
    expect(() => computeHoldings(txs, "average")).toThrow(
      InsufficientHoldingsError,
    );
  });

  it("selling everything leaves nothing and zero cost", () => {
    const txs: Tx[] = [
      tx({ type: "buy", quantity: 3, finalValueCents: 100, at: "2026-01-01" }),
      tx({ type: "buy", quantity: 1, finalValueCents: 51, at: "2026-01-02" }),
      tx({ type: "sell", quantity: 4, finalValueCents: 400, at: "2026-02-01" }),
    ];
    const h = computeHoldings(txs, "average");
    expect(h.quantity).toBe(0);
    expect(h.avgCostCents).toBe(0);
    expect(h.realizedProfitCents).toBe(400 - 151);
  });

  it("keeps integer cents exact when the average does not divide evenly", () => {
    // 3 units for 100 → 33.33…/unit. Sell 1, then 1, then 1.
    const txs: Tx[] = [
      tx({ type: "buy", quantity: 3, finalValueCents: 100, at: "2026-01-01" }),
      tx({ type: "sell", quantity: 1, finalValueCents: 50, at: "2026-02-01" }),
      tx({ type: "sell", quantity: 1, finalValueCents: 50, at: "2026-03-01" }),
      tx({ type: "sell", quantity: 1, finalValueCents: 50, at: "2026-04-01" }),
    ];
    const h = computeHoldings(txs, "average");
    // Every cent of the 100 cost must be accounted for across the sells.
    expect(h.realizedProfitCents).toBe(150 - 100);
    expect(h.quantity).toBe(0);
  });

  it("excludes pending buys from the pool", () => {
    const txs: Tx[] = [
      tx({ type: "buy", quantity: 1, finalValueCents: 100, at: "2026-01-01" }),
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 900,
        at: "2026-01-02",
        status: "pending",
      }),
      tx({ type: "sell", quantity: 1, finalValueCents: 150, at: "2026-02-01" }),
    ];
    expect(computeHoldings(txs, "average").realizedProfitCents).toBe(50);
  });
});

describe("cost method invariants", () => {
  const scenarios: Record<string, Tx[]> = {
    twoBuysOneSell,
    interleaved: [
      tx({ type: "buy", quantity: 5, finalValueCents: 500, at: "2026-01-01" }),
      tx({ type: "sell", quantity: 2, finalValueCents: 350, at: "2026-01-10" }),
      tx({ type: "buy", quantity: 3, finalValueCents: 900, at: "2026-01-20" }),
      tx({
        type: "sell",
        quantity: 4,
        finalValueCents: 1000,
        at: "2026-02-01",
      }),
      tx({ type: "buy", quantity: 2, finalValueCents: 777, at: "2026-02-10" }),
    ],
    lots: [
      tx({
        type: "buy",
        quantity: 2,
        finalValueCents: 200,
        at: "2026-01-01",
        lotId: "a",
      }),
      tx({
        type: "buy",
        quantity: 2,
        finalValueCents: 500,
        at: "2026-01-05",
        lotId: "b",
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 400,
        at: "2026-02-01",
        lotId: "b",
      }),
      tx({ type: "sell", quantity: 2, finalValueCents: 500, at: "2026-02-05" }),
    ],
  };

  for (const [name, txs] of Object.entries(scenarios)) {
    it(`${name}: realized − remaining cost is the same under both methods`, () => {
      // realized = sold − bought + remainingCost, whichever units were
      // deemed to leave. So realized − remainingCost (= sold − bought) must
      // not depend on the method; only the realized/unrealized split does.
      const f = computeHoldings(txs, "fifo");
      const a = computeHoldings(txs, "average");
      const fifoGap = f.realizedProfitCents - f.quantity * f.avgCostCents;
      const avgGap = a.realizedProfitCents - a.quantity * a.avgCostCents;
      expect(f.quantity).toBe(a.quantity);
      // avgCost is rounded to a whole cent per unit, so allow that slack.
      expect(Math.abs(fifoGap - avgGap)).toBeLessThanOrEqual(f.quantity);
    });
  }

  it("cashflow replay agrees with holdings under both methods", () => {
    for (const method of ["fifo", "average"] as CostMethod[]) {
      for (const txs of Object.values(scenarios)) {
        const realized = replayItemEvents(txs, method).reduce(
          (s, e) => s + e.realized,
          0,
        );
        // Cashflow replay does not model pending buys; none here.
        expect(realized).toBe(computeHoldings(txs, method).realizedProfitCents);
      }
    }
  });

  it("analytics replay agrees with holdings under both methods", () => {
    for (const method of ["fifo", "average"] as CostMethod[]) {
      for (const txs of Object.values(scenarios)) {
        const withIds = txs.map((x, i) => ({ ...x, id: `tx${i}` }));
        const { sells } = replayForAnalytics(withIds, method);
        const realized = sells.reduce((s, x) => s + x.realizedCents, 0);
        expect(realized).toBe(computeHoldings(txs, method).realizedProfitCents);
      }
    }
  });
});

describe("consumeQueue", () => {
  it("reports how many units could not be found", () => {
    const q = [{ qty: 1, cost: 10, lotId: null }];
    expect(consumeQueue(q, 3, null, "fifo")).toEqual({
      consumed: 10,
      shortBy: 2,
    });
    const q2 = [{ qty: 1, cost: 10, lotId: null }];
    expect(consumeQueue(q2, 3, null, "average")).toEqual({
      consumed: 10,
      shortBy: 2,
    });
  });

  it("calls onTake oldest-first with the units removed", () => {
    const q = [
      { qty: 2, cost: 200, lotId: null },
      { qty: 2, cost: 400, lotId: null },
    ];
    const taken: number[] = [];
    consumeQueue(q, 3, null, "fifo", (_e, n) => taken.push(n));
    expect(taken).toEqual([2, 1]);
  });
});

describe("InsufficientHoldingsError reports what was actually available", () => {
  const buy = (qty: number, lotId: string | null = null) =>
    tx({
      type: "buy",
      quantity: qty,
      finalValueCents: qty * 100,
      at: "2026-01-01",
      lotId,
    });

  const heldIn = (txs: Tx[], method: CostMethod): number | null => {
    try {
      computeHoldings(txs, method);
    } catch (e) {
      if (e instanceof InsufficientHoldingsError) return e.heldQty;
      throw e;
    }
    return null;
  };

  it.each(["fifo", "average"] as CostMethod[])(
    "%s: selling 2 with 1 held says 1 held, not 0",
    (method) => {
      const txs = [
        buy(1),
        tx({
          type: "sell",
          quantity: 2,
          finalValueCents: 300,
          at: "2026-02-01",
        }),
      ];
      expect(heldIn(txs, method)).toBe(1);
    },
  );

  it("fifo: a lot sell reports only that lot's units", () => {
    const txs = [
      buy(5, "a"),
      buy(1, "b"),
      tx({
        type: "sell",
        quantity: 3,
        finalValueCents: 300,
        at: "2026-02-01",
        lotId: "b",
      }),
    ];
    expect(heldIn(txs, "fifo")).toBe(1);
  });

  it("average: reports the whole pool, since lots don't matter", () => {
    const txs = [
      buy(5, "a"),
      buy(1, "b"),
      tx({
        type: "sell",
        quantity: 9,
        finalValueCents: 900,
        at: "2026-02-01",
        lotId: "b",
      }),
    ];
    expect(heldIn(txs, "average")).toBe(6);
  });
});
