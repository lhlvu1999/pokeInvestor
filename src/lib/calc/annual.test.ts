import { describe, expect, it } from "vitest";
import {
  linesOfYear,
  margin,
  parseYear,
  salesCsv,
  summarizeYears,
  winRate,
  type SaleLine,
} from "./annual";

let n = 0;
function line(over: Partial<SaleLine> & { day: string }): SaleLine {
  const { day, ...rest } = over;
  const proceeds = rest.proceeds ?? 1000;
  const cost = rest.cost ?? 600;
  return {
    txId: `t${n++}`,
    itemId: "i1",
    itemName: "Box",
    soldOn: new Date(`${day}T12:00:00Z`),
    qty: 1,
    reason: "sold",
    proceeds,
    cost,
    realized: proceeds - cost,
    currency: "VND",
    daysHeld: 10,
    shown: { proceeds, cost, realized: proceeds - cost },
    ...rest,
  };
}

describe("summarizeYears", () => {
  it("groups by UTC year, newest first", () => {
    const out = summarizeYears([
      line({ day: "2025-12-31" }),
      line({ day: "2026-01-01" }),
      line({ day: "2026-06-01" }),
    ]);
    expect(out.map((y) => [y.year, y.sales])).toEqual([
      [2026, 2],
      [2025, 1],
    ]);
  });

  it("separates write-offs from sales but keeps them in net", () => {
    const [y] = summarizeYears([
      line({ day: "2026-03-01", proceeds: 1000, cost: 600 }),
      line({ day: "2026-03-02", proceeds: 0, cost: 500, reason: "gifted", qty: 2 }),
    ]);
    expect(y.sales).toBe(1);
    expect(y.units).toBe(1);
    expect(y.profit).toBe(400);
    expect(y.writeOffs).toBe(-500);
    expect(y.writeOffUnits).toBe(2);
    expect(y.net).toBe(-100);
  });

  it("counts winners and losers; break-even is neither and still a sale", () => {
    const [y] = summarizeYears([
      line({ day: "2026-01-01", proceeds: 900, cost: 600 }),
      line({ day: "2026-01-02", proceeds: 500, cost: 600 }),
      line({ day: "2026-01-03", proceeds: 600, cost: 600 }),
    ]);
    expect([y.winners, y.losers]).toEqual([1, 1]);
    expect(winRate(y)).toBeCloseTo(1 / 3, 10);
  });

  it("leaves unconverted lines out of the money but counts them", () => {
    const [y] = summarizeYears([
      line({ day: "2026-01-01" }),
      line({ day: "2026-01-02", shown: null }),
    ]);
    expect(y.sales).toBe(1);
    expect(y.unconverted).toBe(1);
    expect(y.profit).toBe(400);
  });

  it("is empty with no lines", () => {
    expect(summarizeYears([])).toEqual([]);
  });

  it("year totals add up to the lifetime total", () => {
    const ls = [
      line({ day: "2024-05-01", proceeds: 700, cost: 300 }),
      line({ day: "2025-05-01", proceeds: 100, cost: 300 }),
      line({ day: "2026-05-01", proceeds: 0, cost: 200, reason: "lost" }),
    ];
    const sum = summarizeYears(ls).reduce((a, y) => a + y.net, 0);
    expect(sum).toBe(ls.reduce((a, l) => a + l.realized, 0));
  });
});

describe("ratios", () => {
  it("has no win rate or margin when there is nothing to judge", () => {
    expect(winRate({ winners: 0, sales: 0 })).toBeNull();
    expect(margin({ profit: 5, cost: 0 })).toBeNull();
    expect(margin({ profit: 50, cost: 200 })).toBe(0.25);
  });
});

describe("parseYear", () => {
  it("accepts only a year the report has", () => {
    expect(parseYear("2026", [2026, 2025])).toBe(2026);
    expect(parseYear("2020", [2026, 2025])).toBeNull();
    expect(parseYear("26", [2026])).toBeNull();
    expect(parseYear(undefined, [2026])).toBeNull();
    expect(parseYear(["2025", "2026"], [2026, 2025])).toBe(2025);
  });
});

describe("linesOfYear", () => {
  it("keeps one year, oldest first", () => {
    const out = linesOfYear(
      [
        line({ day: "2026-05-01" }),
        line({ day: "2025-05-01" }),
        line({ day: "2026-02-01" }),
      ],
      2026,
    );
    expect(out.map((l) => l.soldOn.toISOString().slice(0, 10))).toEqual([
      "2026-02-01",
      "2026-05-01",
    ]);
  });
});

describe("salesCsv", () => {
  const dec = (m: number) => (m / 100).toFixed(2);
  it("writes native amounts and escapes awkward names", () => {
    const csv = salesCsv(
      [line({ day: "2026-02-03", itemName: 'Box, "Alt"', proceeds: 1500, cost: 1000 })],
      dec,
    );
    const [head, row] = csv.trim().split("\n");
    expect(head).toBe(
      "date,item,quantity,kind,proceeds,cost_basis,profit,currency,days_held",
    );
    expect(row).toBe('2026-02-03,"Box, ""Alt""",1,sold,15.00,10.00,5.00,VND,10');
  });

  it("keeps lines that could not be converted", () => {
    const csv = salesCsv([line({ day: "2026-02-03", shown: null })], dec);
    expect(csv.trim().split("\n")).toHaveLength(2);
  });
});
