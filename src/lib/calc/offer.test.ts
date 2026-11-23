import { describe, expect, it } from "vitest";
import {
  isBelowCost,
  offerText,
  offerTotals,
  offerUnitPrice,
  pctOfMarket,
  roundingSteps,
  type OfferLine,
} from "./offer";

const line = (o: Partial<OfferLine> = {}): OfferLine => ({
  itemId: "a",
  name: "Prismatic ETB",
  quantity: 2,
  marketUnit: 1000,
  avgCost: 700,
  offerUnit: 850,
  ...o,
});

describe("offerUnitPrice", () => {
  it("takes a percentage of market", () => {
    expect(offerUnitPrice(1000, 85)).toBe(850);
    expect(offerUnitPrice(1000, 100)).toBe(1000);
  });

  it("rounds to the nearest whole unit", () => {
    expect(offerUnitPrice(333, 85)).toBe(283); // 283.05
  });

  it("rounds to a coarser step, half up", () => {
    expect(offerUnitPrice(2_964_609, 85, 10_000)).toBe(2_520_000); // 2,519,918
    expect(offerUnitPrice(2_964_609, 85, 100_000)).toBe(2_500_000);
    expect(offerUnitPrice(1_000, 85, 100)).toBe(900); // 850 → ties round up
  });

  it("is zero without a usable price or percentage", () => {
    expect(offerUnitPrice(0, 85)).toBe(0);
    expect(offerUnitPrice(-5, 85)).toBe(0);
    expect(offerUnitPrice(1000, 0)).toBe(0);
  });

  it("treats a bad step as no rounding", () => {
    expect(offerUnitPrice(1000, 85, 0)).toBe(850);
    expect(offerUnitPrice(1000, 85, -3)).toBe(850);
  });

  it("can offer above market", () => {
    expect(offerUnitPrice(1000, 110)).toBe(1100);
  });
});

describe("offerTotals", () => {
  it("sums buyer-facing and private figures separately", () => {
    const t = offerTotals([
      line({ quantity: 2, marketUnit: 1000, avgCost: 700, offerUnit: 850 }),
      line({
        itemId: "b",
        quantity: 1,
        marketUnit: 500,
        avgCost: 600,
        offerUnit: 425,
      }),
    ]);
    expect(t.reference).toBe(2500);
    expect(t.offer).toBe(2125);
    expect(t.buyerSaves).toBe(375);
    expect(t.cost).toBe(2000);
    expect(t.profit).toBe(125);
    expect(t.units).toBe(3);
    expect(t.effectivePct).toBeCloseTo(85);
  });

  it("is all zero for an empty lot", () => {
    const t = offerTotals([]);
    expect(t).toMatchObject({ reference: 0, offer: 0, profit: 0, units: 0 });
    expect(t.effectivePct).toBeNull();
  });

  it("reports a loss as negative profit", () => {
    expect(offerTotals([line({ avgCost: 900, offerUnit: 800 })]).profit).toBe(
      -200,
    );
  });
});

describe("isBelowCost", () => {
  it("flags an offer under average cost", () => {
    expect(isBelowCost(line({ avgCost: 900, offerUnit: 800 }))).toBe(true);
  });
  it("does not flag at or above cost, or when cost is unknown", () => {
    expect(isBelowCost(line({ avgCost: 800, offerUnit: 800 }))).toBe(false);
    expect(isBelowCost(line({ avgCost: 700, offerUnit: 800 }))).toBe(false);
    expect(isBelowCost(line({ avgCost: 0, offerUnit: 1 }))).toBe(false);
  });
});

describe("pctOfMarket", () => {
  it("rounds to a whole percent", () => {
    expect(pctOfMarket(850, 1000)).toBe(85);
    expect(pctOfMarket(2_520_000, 2_964_609)).toBe(85);
    expect(pctOfMarket(1, 0)).toBe(0);
  });
});

describe("roundingSteps", () => {
  it("offers thousand-scale steps for zero-decimal currencies", () => {
    const s = roundingSteps(0);
    expect(s.map((x) => x.step)).toEqual([1, 1000, 10_000, 100_000]);
    expect(s[0].label).toBe("Exact");
  });
  it("offers whole-unit steps in minor units for two-decimal currencies", () => {
    expect(roundingSteps(2).map((x) => x.step)).toEqual([1, 100, 500, 1000]);
  });
});

describe("offerText", () => {
  const lines = [
    line({
      name: "Destined Rivals ETB",
      quantity: 3,
      marketUnit: 2_964_609,
      avgCost: 2_750_000,
      offerUnit: 2_520_000,
    }),
  ];
  const text = offerText(lines, "VND", "23 Nov '26");

  it("lists each item with quantity, unit offer, percent and total", () => {
    expect(text).toContain("Offer · 23 Nov '26");
    expect(text).toContain("1. Destined Rivals ETB ×3");
    expect(text).toContain(
      "₫2,520,000 each (85% of market ₫2,964,609) = ₫7,560,000",
    );
  });

  it("ends with the total and what the buyer saves", () => {
    expect(text).toContain("Total: ₫7,560,000 for 3 units");
    expect(text).toContain("Market value: ₫8,893,827 · you save ₫1,333,827");
  });

  it("never mentions cost or profit", () => {
    expect(text.toLowerCase()).not.toMatch(/cost|profit|paid|margin/);
    expect(text).not.toContain("2,750,000"); // the average cost
  });

  it("uses singular for one unit", () => {
    expect(offerText([line({ quantity: 1 })], "VND", "d")).toContain(
      "for 1 unit\n",
    );
  });
});
