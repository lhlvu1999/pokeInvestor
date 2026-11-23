import { describe, expect, it } from "vitest";
import { computeCapitalFlow, lastMonths, type CapitalEvent } from "./capital";
import { computeHoldings, type CostMethod } from "./holdings";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const buy = (iso: string, amount: number): CapitalEvent => ({
  at: at(iso),
  type: "buy",
  amount,
});
const sell = (iso: string, amount: number): CapitalEvent => ({
  at: at(iso),
  type: "sell",
  amount,
});

describe("computeCapitalFlow", () => {
  it("is empty without activity", () => {
    const f = computeCapitalFlow([]);
    expect(f).toMatchObject({ ownMoneyIn: 0, spent: 0, pool: 0, months: [] });
    expect(f.selfFundedPct).toBeNull();
  });

  it("treats buys with no proceeds as all new money", () => {
    const f = computeCapitalFlow([
      buy("2026-01-05", 100),
      buy("2026-01-09", 50),
    ]);
    expect(f).toMatchObject({
      ownMoneyIn: 150,
      rolled: 0,
      spent: 150,
      pool: 0,
    });
    expect(f.selfFundedPct).toBe(0);
  });

  it("funds a later buy from earlier sale proceeds first", () => {
    const f = computeCapitalFlow([
      buy("2026-01-01", 100),
      sell("2026-01-10", 80),
      buy("2026-01-20", 120), // 80 rolled + 40 new
    ]);
    expect(f.ownMoneyIn).toBe(140);
    expect(f.rolled).toBe(80);
    expect(f.pool).toBe(0);
    expect(f.selfFundedPct).toBeCloseTo(80 / 220);
  });

  it("leaves unspent proceeds in the pool", () => {
    const f = computeCapitalFlow([
      buy("2026-01-01", 100),
      sell("2026-02-01", 300),
    ]);
    expect(f.pool).toBe(300);
    expect(f.proceeds).toBe(300);
    expect(f.ownMoneyIn).toBe(100);
  });

  it("does not let a buy spend proceeds that arrive later", () => {
    const f = computeCapitalFlow([
      buy("2026-01-01", 100),
      sell("2026-02-01", 100),
    ]);
    expect(f.rolled).toBe(0);
    expect(f.ownMoneyIn).toBe(100);
  });

  it("applies sales first when timestamps tie", () => {
    const f = computeCapitalFlow([
      buy("2026-03-01", 100),
      { at: at("2026-03-01"), type: "sell", amount: 100 },
    ]);
    expect(f.rolled).toBe(100);
    expect(f.ownMoneyIn).toBe(0);
  });

  it("is independent of input order", () => {
    const events = [
      buy("2026-01-01", 100),
      sell("2026-01-10", 80),
      buy("2026-01-20", 120),
      sell("2026-03-02", 40),
    ];
    const a = computeCapitalFlow(events);
    const b = computeCapitalFlow([...events].reverse());
    expect(b).toEqual(a);
  });

  it("buckets by month with running totals, filling quiet months", () => {
    const f = computeCapitalFlow([
      buy("2026-01-01", 100),
      sell("2026-01-15", 60),
      buy("2026-04-02", 90), // 60 rolled + 30 new
    ]);
    expect(f.months.map((m) => m.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(f.months[0]).toMatchObject({
      fresh: 100,
      proceeds: 60,
      ownMoneyIn: 100,
      pool: 60,
    });
    // Quiet months carry the running totals forward.
    expect(f.months[2]).toMatchObject({
      fresh: 0,
      rolled: 0,
      ownMoneyIn: 100,
      pool: 60,
    });
    expect(f.months[3]).toMatchObject({
      fresh: 30,
      rolled: 60,
      ownMoneyIn: 130,
      pool: 0,
    });
  });

  it("keeps lifetime totals equal to the sum of the months", () => {
    const f = computeCapitalFlow([
      buy("2026-01-01", 100),
      sell("2026-02-10", 80),
      buy("2026-03-20", 120),
      sell("2026-03-21", 500),
    ]);
    const sum = (k: "fresh" | "rolled" | "proceeds") =>
      f.months.reduce((s, m) => s + m[k], 0);
    expect(sum("fresh")).toBe(f.ownMoneyIn);
    expect(sum("rolled")).toBe(f.rolled);
    expect(sum("proceeds")).toBe(f.proceeds);
  });

  it("ignores zero-value buys but still records a zero-value exit", () => {
    const f = computeCapitalFlow([buy("2026-01-01", 0), sell("2026-01-02", 0)]);
    expect(f.spent).toBe(0);
    expect(f.months).toHaveLength(1);
  });
});

describe("lastMonths", () => {
  it("returns the tail, or everything when shorter", () => {
    const f = computeCapitalFlow([buy("2026-01-01", 1), buy("2026-05-01", 1)]);
    expect(lastMonths(f.months, 2).map((m) => m.month)).toEqual([
      "2026-04",
      "2026-05",
    ]);
    expect(lastMonths(f.months, 99)).toHaveLength(5);
  });
});

describe("agrees with the holdings engine", () => {
  type Tx = Parameters<typeof computeHoldings>[0][number];
  const tx = (
    iso: string,
    type: "buy" | "sell",
    quantity: number,
    value: number,
    status: "received" | "pending" = "received",
  ): Tx => ({
    type,
    quantity,
    finalValueCents: value,
    occurredAt: at(iso),
    currency: "VND",
    lotId: null,
    status,
    shippingCents: null,
  });
  const history: Tx[] = [
    tx("2026-01-01", "buy", 10, 1000),
    tx("2026-01-20", "sell", 4, 900),
    tx("2026-02-02", "buy", 5, 800),
    tx("2026-02-10", "sell", 6, 1100),
    tx("2026-03-01", "buy", 2, 300, "pending"),
    tx("2026-03-05", "sell", 1, 0), // a gift: leaves with no proceeds
    tx("2026-03-09", "buy", 3, 450),
  ];

  for (const method of ["fifo", "average"] as CostMethod[]) {
    it(`matches lifetime bought / sold under ${method}`, () => {
      const h = computeHoldings(history, method);
      const flow = computeCapitalFlow(
        history.map((t) => ({
          at: t.occurredAt,
          type: t.type,
          amount: t.finalValueCents,
        })),
      );
      // Pending buys are money out of pocket, so they are in both.
      expect(flow.spent).toBe(h.totalBoughtCents);
      expect(flow.proceeds).toBe(h.totalSoldCents);
      // Every unit of proceeds is either rolled over or still in the pool.
      expect(flow.rolled + flow.pool).toBe(flow.proceeds);
      expect(flow.ownMoneyIn - flow.pool).toBe(
        h.totalBoughtCents - h.totalSoldCents,
      );
    });
  }
});
