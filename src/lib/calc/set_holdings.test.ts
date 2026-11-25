import { describe, expect, it } from "vitest";
import { summarizeSetHoldings, type SetItemInput } from "./set_holdings";

const row = (o: Partial<SetItemInput> & { id: string }): SetItemInput => ({
  name: o.id,
  imageUrl: null,
  units: 1,
  cost: 100,
  value: 150,
  hasPrice: true,
  ...o,
});

describe("summarizeSetHoldings", () => {
  it("adds up what you hold and ranks items by value", () => {
    const s = summarizeSetHoldings([
      row({ id: "a", units: 2, cost: 200, value: 300 }),
      row({ id: "b", units: 5, cost: 500, value: 900 }),
    ]);
    expect(s.held.map((h) => h.id)).toEqual(["b", "a"]);
    expect(s.units).toBe(7);
    expect(s.cost).toBe(700);
    expect(s.value).toBe(1200);
    expect(s.held[0].shareOfValue).toBeCloseTo(0.75);
    expect(s.held[1].shareOfValue).toBeCloseTo(0.25);
  });

  it("counts sold-out items apart and leaves them out of the totals", () => {
    const s = summarizeSetHoldings([
      row({ id: "a" }),
      row({ id: "gone", units: 0, cost: 0, value: 0 }),
    ]);
    expect(s.soldOut).toBe(1);
    expect(s.held.map((h) => h.id)).toEqual(["a"]);
    expect(s.units).toBe(1);
  });

  it("keeps unpriced items out of the value but shows their cost", () => {
    const s = summarizeSetHoldings([
      row({ id: "priced", cost: 100, value: 160 }),
      row({ id: "unpriced", cost: 400, value: 0, hasPrice: false }),
    ]);
    expect(s.value).toBe(160);
    expect(s.cost).toBe(500);
    expect(s.unpriced).toBe(1);
    expect(s.unpricedCost).toBe(400);
    expect(s.held.map((h) => h.id)).toEqual(["priced", "unpriced"]);
    expect(s.held[1].shareOfValue).toBeNull();
  });

  it("is empty with no items", () => {
    const s = summarizeSetHoldings([]);
    expect(s).toMatchObject({ held: [], soldOut: 0, units: 0, cost: 0, value: 0, unpriced: 0 });
  });

  it("gives no shares when nothing held is priced", () => {
    const s = summarizeSetHoldings([row({ id: "a", value: 0, hasPrice: false })]);
    expect(s.held[0].shareOfValue).toBeNull();
  });
});
