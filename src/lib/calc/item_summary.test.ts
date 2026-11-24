import { describe, expect, it } from "vitest";
import { summarizeItem, type ItemSummaryInput } from "./item_summary";

const money = (n: number) => `$${(n / 100).toFixed(2)}`;

const base: ItemSummaryInput = {
  held: 3,
  pending: 0,
  boughtUnits: 5,
  soldUnits: 2,
  exitUnits: 0,
  avgCost: 10_000,
  inventoryCost: 30_000,
  marketPrice: 12_000,
  priceAgeDays: 1,
  weekChangePct: null,
  realized: 5_000,
  unrealized: 6_000,
  mentions: null,
  money,
};

const text = (i: Partial<ItemSummaryInput>) =>
  summarizeItem({ ...base, ...i })
    .map((l) => l.text)
    .join(" ");

describe("summarizeItem", () => {
  it("describes a normal position in order: what you hold, its value, results", () => {
    const lines = summarizeItem(base);
    expect(lines.map((l) => l.group)).toEqual([0, 0, 0, 1, 2, 2]);
    expect(lines[0].text).toBe("You hold 3 units.");
    expect(lines[1].text).toBe("Over time you bought 5 and sold 2.");
    expect(lines[2].text).toContain("$100.00 each");
    expect(lines[2].text).toContain("$300.00 in all");
  });

  it("states what it is worth and the gap to cost, in words", () => {
    const t = text({});
    // 3 × $120 = $360 vs $300 cost → $60.00 (20.0%) more
    expect(t).toContain("worth about $360.00");
    expect(t).toContain("$60.00 (20.0%) more than you paid");
  });

  it("says 'less' for a loss and 'exactly' for break-even", () => {
    expect(text({ marketPrice: 8_000 })).toContain(
      "$60.00 (20.0%) less than you paid",
    );
    expect(text({ marketPrice: 10_000 })).toContain("exactly what you paid");
  });

  it("flags a missing price instead of inventing a value", () => {
    const lines = summarizeItem({
      ...base,
      marketPrice: null,
      priceAgeDays: null,
    });
    const warn = lines.find((l) => l.warn);
    expect(warn?.text).toContain("no market price");
    expect(lines.some((l) => l.text.includes("worth about"))).toBe(false);
    // And it must not claim an overall total that needs a price.
    expect(lines.some((l) => l.text.startsWith("All in"))).toBe(false);
  });

  it("calls out a stale price, and not a fresh one", () => {
    expect(text({ priceAgeDays: 9 })).toContain("9 days old");
    expect(text({ priceAgeDays: 1 })).not.toContain("days old");
  });

  it("mentions the weekly move only when it is more than noise", () => {
    expect(text({ weekChangePct: 0.123 })).toContain("rose 12.3%");
    expect(text({ weekChangePct: -0.05 })).toContain("fell 5.0%");
    expect(text({ weekChangePct: 0.001 })).not.toContain("Over the past week");
    expect(text({ weekChangePct: null })).not.toContain("Over the past week");
  });

  it("reports on-the-way units, and the none-in-hand case", () => {
    expect(text({ pending: 2 })).toContain(
      "You hold 3 units and 2 more are on the way.",
    );
    const t = text({
      held: 0,
      pending: 1,
      inventoryCost: 0,
      avgCost: 0,
      soldUnits: 0,
      boughtUnits: 1,
    });
    expect(t).toContain("Nothing in hand yet: 1 unit is on the way.");
  });

  it("handles an item that has been fully sold", () => {
    const lines = summarizeItem({
      ...base,
      held: 0,
      inventoryCost: 0,
      avgCost: 0,
      marketPrice: null,
      priceAgeDays: null,
      boughtUnits: 4,
      soldUnits: 4,
      realized: 8_000,
    });
    const t = lines.map((l) => l.text).join(" ");
    expect(t).toContain("You don't hold any of this now.");
    expect(t).toContain("bought 4 and sold 4");
    expect(t).toContain("you've made $80.00");
    // Nothing is held, so no price is needed for the overall total.
    expect(t).toContain("All in, you're up $80.00 on this item.");
    expect(lines.some((l) => l.warn)).toBe(false);
  });

  it("separates gifted/lost units from sales and says they were booked at zero", () => {
    const t = text({
      boughtUnits: 6,
      soldUnits: 3,
      exitUnits: 1,
      realized: -2_000,
    });
    expect(t).toContain("bought 6, sold 2 and 1 gifted, lost or opened");
    expect(t).toContain("you've lost $20.00");
    expect(t).toContain("1 unit given away, lost or opened (booked as $0.00)");
  });

  it("totals realized plus unrealized when something is still held", () => {
    // realized 5,000 + unrealized 6,000 = $110.00 up
    expect(text({})).toContain(
      "All in, you're up $110.00 on this item, counting what you still hold at its market price.",
    );
    expect(text({ realized: -20_000, unrealized: 6_000 })).toContain(
      "you're down $140.00",
    );
  });

  it("includes creator mentions with correct plurals, and omits them when there are none", () => {
    expect(
      text({ mentions: { total: 1, bullish: 1, bearish: 0, channels: 1 } }),
    ).toContain("mentioned it 1 time across 1 channel: 1 bullish, 0 bearish");
    expect(
      text({ mentions: { total: 7, bullish: 4, bearish: 2, channels: 3 } }),
    ).toContain(
      "7 times across 3 channels: 4 bullish, 2 bearish, 1 neutral or mixed.",
    );
    expect(
      text({ mentions: { total: 3, bullish: 0, bearish: 0, channels: 1 } }),
    ).toContain("0 bullish, 0 bearish, 3 neutral or mixed.");
    expect(
      text({ mentions: { total: 2, bullish: 1, bearish: 1, channels: 2 } }),
    ).toContain("1 bullish, 1 bearish.");
    expect(
      text({ mentions: { total: 0, bullish: 0, bearish: 0, channels: 0 } }),
    ).not.toContain("Creators");
  });

  it("skips results entirely when nothing has been sold", () => {
    const lines = summarizeItem({ ...base, soldUnits: 0, realized: 0 });
    expect(lines.some((l) => l.group === 2)).toBe(false);
  });

  it("gives nothing for an item with no activity at all", () => {
    expect(
      summarizeItem({
        ...base,
        held: 0,
        pending: 0,
        boughtUnits: 0,
        soldUnits: 0,
        marketPrice: null,
        priceAgeDays: null,
        inventoryCost: 0,
        avgCost: 0,
        realized: 0,
        unrealized: 0,
      }),
    ).toEqual([]);
  });
});
