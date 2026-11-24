import { describe, expect, it } from "vitest";
import {
  activeYears,
  endOfDay,
  flowGap,
  heldOn,
  isDay,
  isStale,
  priceOnOrBefore,
  stockCsv,
  yearFlow,
  type StockTx,
} from "./stock_on";

let n = 0;
const tx = (
  type: "buy" | "sell",
  day: string,
  quantity: number,
  value: number,
  over: Partial<StockTx> = {},
): StockTx => ({
  id: `t${n++}`,
  type,
  quantity,
  finalValueCents: value,
  occurredAt: new Date(`${day}T12:00:00Z`),
  currency: "VND",
  lotId: null,
  status: "received",
  exitReason: null,
  ...over,
});

const NOW = new Date("2027-06-15T00:00:00Z");

describe("heldOn", () => {
  const txs = [
    tx("buy", "2026-03-01", 4, 400),
    tx("sell", "2026-06-01", 1, 150),
    tx("buy", "2027-02-01", 2, 400),
  ];
  it("replays only what happened by that day", () => {
    expect(heldOn(txs, endOfDay("2026-12-31"), "fifo")).toEqual({ qty: 3, cost: 300 });
    expect(heldOn(txs, endOfDay("2027-12-31"), "fifo")).toEqual({ qty: 5, cost: 700 });
  });
  it("is empty before the first transaction", () => {
    expect(heldOn(txs, endOfDay("2026-01-01"), "fifo")).toEqual({ qty: 0, cost: 0 });
  });
  it("includes a transaction on the day itself", () => {
    expect(heldOn(txs, endOfDay("2026-03-01"), "fifo").qty).toBe(4);
    expect(heldOn(txs, endOfDay("2026-02-28"), "fifo").qty).toBe(0);
  });
  it("leaves out buys that have not arrived", () => {
    const pending = [...txs, tx("buy", "2026-04-01", 10, 9999, { status: "pending" })];
    expect(heldOn(pending, endOfDay("2026-12-31"), "fifo").qty).toBe(3);
  });
  it("follows the cost method", () => {
    const two = [tx("buy", "2026-01-01", 1, 100), tx("buy", "2026-01-02", 1, 300), tx("sell", "2026-01-03", 1, 500)];
    expect(heldOn(two, endOfDay("2026-12-31"), "fifo").cost).toBe(300);
    expect(heldOn(two, endOfDay("2026-12-31"), "average").cost).toBe(200);
  });
});

describe("yearFlow", () => {
  const txs = [
    tx("buy", "2026-03-01", 4, 400),
    tx("sell", "2026-06-01", 1, 150),
    tx("buy", "2027-02-01", 2, 400),
    tx("sell", "2027-03-01", 3, 0, { exitReason: "gifted" }),
  ];

  it("reconciles a completed year", () => {
    const f = yearFlow(txs, 2026, "fifo", NOW);
    expect(f.complete).toBe(true);
    expect(f.open).toEqual({ qty: 0, cost: 0 });
    expect(f.bought).toBe(400);
    expect(f.out).toBe(100);
    expect(f.close).toEqual({ qty: 3, cost: 300 });
    expect(flowGap(f)).toBe(0);
  });

  it("carries the closing stock into the next year as opening", () => {
    const f = yearFlow(txs, 2027, "fifo", NOW);
    expect(f.open).toEqual({ qty: 3, cost: 300 });
    expect(f.bought).toBe(400);
    // The gift removes the oldest 3 units: 100 x 3.
    expect(f.out).toBe(300);
    expect(f.close).toEqual({ qty: 2, cost: 400 });
    expect(flowGap(f)).toBe(0);
  });

  it("closes a year in progress today and ignores later entries", () => {
    const future = [...txs, tx("buy", "2027-09-01", 5, 5000)];
    const f = yearFlow(future, 2027, "fifo", NOW);
    expect(f.complete).toBe(false);
    expect(f.closedOn).toEqual(NOW);
    expect(f.bought).toBe(400);
    expect(flowGap(f)).toBe(0);
  });

  it("does not count a pending buy as bought", () => {
    const f = yearFlow([...txs, tx("buy", "2026-05-01", 9, 777, { status: "pending" })], 2026, "fifo", NOW);
    expect(f.bought).toBe(400);
    expect(flowGap(f)).toBe(0);
  });

  it("still reconciles when the same item is bought and sold within a year", () => {
    const t = [tx("buy", "2026-01-10", 2, 200), tx("sell", "2026-01-20", 2, 500)];
    const f = yearFlow(t, 2026, "fifo", NOW);
    expect(f.close).toEqual({ qty: 0, cost: 0 });
    expect(f.out).toBe(200);
    expect(flowGap(f)).toBe(0);
  });

  it("reconciles under the average method too", () => {
    const t = [
      tx("buy", "2026-01-01", 3, 100),
      tx("buy", "2026-02-01", 3, 201),
      tx("sell", "2026-03-01", 2, 400),
      tx("sell", "2027-01-05", 1, 400),
      tx("buy", "2027-02-01", 1, 77),
    ];
    for (const y of [2026, 2027]) {
      expect(flowGap(yearFlow(t, y, "average", NOW))).toBe(0);
    }
  });

  it("reconciles when a sell is larger than what was held", () => {
    const t = [tx("buy", "2026-01-01", 1, 100), tx("sell", "2026-02-01", 3, 900)];
    expect(flowGap(yearFlow(t, 2026, "fifo", NOW))).toBe(0);
  });

  it("is empty for a year before anything happened", () => {
    const f = yearFlow(txs, 2020, "fifo", NOW);
    expect(f.bought + f.out + f.close.cost + f.open.cost).toBe(0);
  });
});

describe("activeYears", () => {
  it("lists the current year back to the first, newest first", () => {
    expect(activeYears([tx("buy", "2025-03-01", 1, 1)], NOW)).toEqual([2027, 2026, 2025]);
    expect(activeYears([], NOW)).toEqual([]);
  });
});

describe("prices", () => {
  const p = (day: string, c: number) => ({ priceCents: c, fetchedAt: new Date(`${day}T10:00:00Z`) });
  const sorted = [p("2026-09-01", 10), p("2026-10-01", 20), p("2026-11-01", 30)];
  it("takes the latest price on or before the day", () => {
    expect(priceOnOrBefore(sorted, endOfDay("2026-10-15"))?.priceCents).toBe(20);
    expect(priceOnOrBefore(sorted, endOfDay("2026-11-01"))?.priceCents).toBe(30);
    expect(priceOnOrBefore(sorted, endOfDay("2027-01-01"))?.priceCents).toBe(30);
  });
  it("has none before the first price", () => {
    expect(priceOnOrBefore(sorted, endOfDay("2026-08-31"))).toBeNull();
    expect(priceOnOrBefore([], endOfDay("2026-08-31"))).toBeNull();
  });
  it("flags a price that was old on the day", () => {
    expect(isStale(sorted[0], endOfDay("2026-09-20"))).toBe(false);
    expect(isStale(sorted[0], endOfDay("2026-10-15"))).toBe(true);
  });
});

describe("isDay", () => {
  it("accepts real calendar days only", () => {
    expect(isDay("2026-12-31")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("12/31/2026")).toBe(false);
    expect(isDay("")).toBe(false);
  });
});

describe("stockCsv", () => {
  const dec = (m: number) => (m / 100).toFixed(2);
  it("writes native amounts, leaves price blank when there is none, and escapes names", () => {
    const csv = stockCsv(
      "2026-12-31",
      [
        { name: 'Box, "A"', currency: "VND", qty: 2, cost: 1000, priceCents: 700, priceAt: new Date("2026-12-20T10:00:00Z") },
        { name: "No price", currency: "VND", qty: 1, cost: 500, priceCents: null, priceAt: null },
      ],
      dec,
    );
    const [head, a, b] = csv.trim().split("\n");
    expect(head).toBe("as_of,item,units,cost_basis,price_per_unit,price_date,market_value,currency");
    expect(a).toBe('2026-12-31,"Box, ""A""",2,10.00,7.00,2026-12-20,14.00,VND');
    expect(b).toBe("2026-12-31,No price,1,5.00,,,,VND");
  });
});
