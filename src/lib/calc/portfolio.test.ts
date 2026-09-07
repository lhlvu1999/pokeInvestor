import { describe, expect, it } from "vitest";
import { summarizePortfolio, type ConvertedItemValues } from "./portfolio";

const v = (o: Partial<ConvertedItemValues>): ConvertedItemValues => ({
  inventoryCost: 0,
  marketValue: 0,
  realized: 0,
  unrealized: 0,
  quantity: 0,
  totalSpent: 0,
  totalReceived: 0,
  hasPrice: false,
  ...o,
});

describe("summarizePortfolio — totals", () => {
  it("sums the basic figures", () => {
    const s = summarizePortfolio([
      v({
        inventoryCost: 100,
        marketValue: 150,
        realized: 10,
        unrealized: 50,
        quantity: 1,
        hasPrice: true,
      }),
      v({
        inventoryCost: 200,
        marketValue: 180,
        realized: 5,
        unrealized: -20,
        quantity: 2,
        hasPrice: true,
      }),
    ]);
    expect(s.invested).toBe(300);
    expect(s.currentValue).toBe(330);
    expect(s.realized).toBe(15);
    expect(s.unrealized).toBe(30);
    expect(s.total).toBe(45);
    expect(s.itemsHeld).toBe(2);
  });

  it("returns zeros for an empty portfolio", () => {
    const s = summarizePortfolio([]);
    expect(s).toEqual({
      invested: 0,
      currentValue: 0,
      realized: 0,
      unrealized: 0,
      total: 0,
      itemsHeld: 0,
      pricedItemsHeld: 0,
      unpricedItemsHeld: 0,
      investedPriced: 0,
      investedUnpriced: 0,
    });
  });
});

describe("summarizePortfolio — price coverage", () => {
  it("splits held items and cost by whether a price exists", () => {
    const s = summarizePortfolio([
      v({
        inventoryCost: 100,
        marketValue: 150,
        unrealized: 50,
        quantity: 1,
        hasPrice: true,
      }),
      v({
        inventoryCost: 400,
        marketValue: 0,
        unrealized: 0,
        quantity: 3,
        hasPrice: false,
      }),
    ]);
    expect(s.pricedItemsHeld).toBe(1);
    expect(s.unpricedItemsHeld).toBe(1);
    expect(s.investedPriced).toBe(100);
    expect(s.investedUnpriced).toBe(400);
    // The comparable pair is investedPriced vs currentValue, NOT invested.
    expect(s.invested).toBe(500);
    expect(s.currentValue).toBe(150);
  });

  it("does not count sold-out items in coverage", () => {
    // quantity 0 — no longer held, so irrelevant to what we can value.
    const s = summarizePortfolio([
      v({ inventoryCost: 0, realized: 90, quantity: 0, hasPrice: false }),
      v({ inventoryCost: 100, marketValue: 120, quantity: 1, hasPrice: true }),
    ]);
    expect(s.itemsHeld).toBe(1);
    expect(s.pricedItemsHeld).toBe(1);
    expect(s.unpricedItemsHeld).toBe(0);
  });

  it("distinguishes an unpriced item from a genuinely worthless one", () => {
    // Both have marketValue 0, so `marketValue > 0` could not tell them
    // apart — which is why hasPrice is carried explicitly.
    const s = summarizePortfolio([
      v({ inventoryCost: 100, marketValue: 0, quantity: 1, hasPrice: true }),
      v({ inventoryCost: 100, marketValue: 0, quantity: 1, hasPrice: false }),
    ]);
    expect(s.pricedItemsHeld).toBe(1);
    expect(s.unpricedItemsHeld).toBe(1);
    expect(s.investedPriced).toBe(100);
    expect(s.investedUnpriced).toBe(100);
  });

  it("reports full coverage when everything is priced", () => {
    const s = summarizePortfolio([
      v({ inventoryCost: 100, marketValue: 110, quantity: 1, hasPrice: true }),
      v({ inventoryCost: 50, marketValue: 60, quantity: 1, hasPrice: true }),
    ]);
    expect(s.unpricedItemsHeld).toBe(0);
    expect(s.investedUnpriced).toBe(0);
    expect(s.investedPriced).toBe(s.invested);
  });
});
