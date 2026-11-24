import { describe, expect, it } from "vitest";
import { costByPhase } from "./stock_timing";

describe("costByPhase", () => {
  it("splits cost by age band, youngest first, and shares add to 1", () => {
    const r = costByPhase([
      { cost: 300, phase: "established" },
      { cost: 100, phase: "launch" },
      { cost: 100, phase: "launch" },
      { cost: 100, phase: "early" },
      { cost: 100, phase: null },
    ]);
    expect(r.total).toBe(700);
    expect(r.shares.map((s) => [s.phase, s.cost])).toEqual([
      ["launch", 200],
      ["early", 100],
      ["established", 300],
    ]);
    expect(r.unknownCost).toBe(100);
    const sum =
      r.shares.reduce((a, s) => a + s.share, 0) + r.unknownShare;
    expect(sum).toBeCloseTo(1, 12);
    expect(r.shares[0].share).toBeCloseTo(200 / 700, 12);
    expect(r.shares[0].label).toBe("Launch window");
  });

  it("ignores items with no cost and handles an empty stock", () => {
    const r = costByPhase([
      { cost: 0, phase: "launch" },
      { cost: -5, phase: "early" },
    ]);
    expect(r.total).toBe(0);
    expect(r.shares).toEqual([]);
    expect(r.unknownShare).toBe(0);
    expect(costByPhase([]).total).toBe(0);
  });
});
