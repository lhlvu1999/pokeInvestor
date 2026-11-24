import { describe, expect, it } from "vitest";
import { niceTicks } from "./chart_scale";

describe("niceTicks", () => {
  it("picks round steps that cover the range", () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(87, 312, 4)).toEqual([0, 100, 200, 300, 400]);
    expect(niceTicks(-0.3, 0.62, 4)).toEqual([-0.5, -0.25, 0, 0.25, 0.5, 0.75]);
  });

  it("always includes the whole data range", () => {
    for (const [lo, hi] of [
      [3, 7],
      [-1.7, 0.4],
      [99.2, 103.9],
      [0, 0.0123],
      [-250, 1800],
    ]) {
      const t = niceTicks(lo, hi);
      expect(t[0]).toBeLessThanOrEqual(lo);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(hi);
      expect(t.length).toBeGreaterThanOrEqual(2);
      expect(t.length).toBeLessThanOrEqual(10);
    }
  });

  it("has no floating-point dust", () => {
    for (const v of niceTicks(0, 1, 10)) {
      expect(String(v).length).toBeLessThan(8);
    }
  });

  it("copes with equal, reversed and bad input", () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(100, 0, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
    expect(niceTicks(0, Infinity)).toEqual([]);
  });
});
