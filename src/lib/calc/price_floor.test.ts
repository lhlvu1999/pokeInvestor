import { describe, expect, it } from "vitest";
import {
  FLOOR_PRESETS,
  MAX_FLOOR_CENTS,
  floorFromCost,
  floorStanding,
  planBulkFloors,
  type BulkFloorInput,
} from "./price_floor";

const base = { floorCurrency: "VND", priceCurrency: "VND" };

describe("floorStanding", () => {
  it("is none without a floor, whatever the price", () => {
    expect(floorStanding({ ...base, floorCents: null, priceCents: 100 })).toEqual({ state: "none" });
    expect(floorStanding({ ...base, floorCents: 0, priceCents: 100 })).toEqual({ state: "none" });
    expect(floorStanding({ ...base, floorCents: -5, priceCents: 100 })).toEqual({ state: "none" });
  });

  it("has no answer without a price", () => {
    expect(floorStanding({ ...base, floorCents: 100, priceCents: null })).toEqual({ state: "no_price" });
    expect(floorStanding({ ...base, floorCents: 100, priceCents: 0 })).toEqual({ state: "no_price" });
    expect(floorStanding({ floorCents: 100, floorCurrency: "VND", priceCents: 90, priceCurrency: null })).toEqual({ state: "no_price" });
  });

  it("never compares across currencies", () => {
    expect(floorStanding({ floorCents: 100, floorCurrency: "VND", priceCents: 5, priceCurrency: "USD" })).toEqual({
      state: "currency_mismatch",
      floorCurrency: "VND",
      priceCurrency: "USD",
    });
  });

  it("is reached when the price is below the floor, and says by how much", () => {
    const s = floorStanding({ ...base, floorCents: 100, priceCents: 80 });
    expect(s.state).toBe("reached");
    if (s.state === "reached") expect(s.belowBy).toBeCloseTo(0.2, 10);
  });

  it("is reached when the price is exactly at the floor", () => {
    const s = floorStanding({ ...base, floorCents: 100, priceCents: 100 });
    expect(s).toMatchObject({ state: "reached", belowBy: 0 });
  });

  it("is above while the price is higher, and says how far it would have to fall", () => {
    const s = floorStanding({ ...base, floorCents: 80, priceCents: 100 });
    expect(s.state).toBe("above");
    if (s.state === "above") expect(s.toFall).toBeCloseTo(0.2, 10);
  });

  it("the two sides meet cleanly at the boundary", () => {
    expect(floorStanding({ ...base, floorCents: 100, priceCents: 101 }).state).toBe("above");
    expect(floorStanding({ ...base, floorCents: 100, priceCents: 100 }).state).toBe("reached");
    expect(floorStanding({ ...base, floorCents: 100, priceCents: 99 }).state).toBe("reached");
  });
});

describe("floorFromCost", () => {
  it("is the cost itself at 0, and a share below it otherwise", () => {
    expect(floorFromCost(1_000_000, 0)).toBe(1_000_000);
    expect(floorFromCost(1_000_000, 0.1)).toBe(900_000);
    expect(floorFromCost(1_000_000, 0.2)).toBe(800_000);
  });
  it("rounds to a whole minor unit", () => {
    expect(floorFromCost(333, 0.1)).toBe(300); // 299.7
    expect(floorFromCost(1, 0.1)).toBe(1); // 0.9 rounds up to 1, still a valid floor
  });
  it("has no answer without a cost or with a nonsense fraction", () => {
    expect(floorFromCost(0, 0.1)).toBeNull();
    expect(floorFromCost(-5, 0.1)).toBeNull();
    expect(floorFromCost(NaN, 0.1)).toBeNull();
    expect(floorFromCost(100, -0.1)).toBeNull();
    expect(floorFromCost(100, 1)).toBeNull();
    expect(floorFromCost(100, NaN)).toBeNull();
  });
  it("refuses what would not fit the column", () => {
    expect(floorFromCost(MAX_FLOOR_CENTS + 1, 0)).toBeNull();
    expect(floorFromCost(MAX_FLOOR_CENTS, 0)).toBe(MAX_FLOOR_CENTS);
  });
  it("offers at-cost and two steps below it", () => {
    expect(FLOOR_PRESETS.map((p) => p.below)).toEqual([0, 0.1, 0.2]);
  });
});

describe("planBulkFloors", () => {
  const row = (o: Partial<BulkFloorInput> = {}): BulkFloorInput => ({
    id: "a",
    name: "A",
    held: 2,
    avgCostCents: 1000,
    currency: "VND",
    hasFloor: false,
    priceCents: 1500,
    priceCurrency: "VND",
    ...o,
  });

  it("sets floors below cost for held items that have none", () => {
    const r = planBulkFloors([row(), row({ id: "b", avgCostCents: 2000 })], 0.2);
    expect(r.plans.map((p) => [p.id, p.floorCents, p.currency])).toEqual([
      ["a", 800, "VND"],
      ["b", 1600, "VND"],
    ]);
    expect(r.alreadySet).toBe(0);
    expect(r.noCost).toBe(0);
  });

  it("never overwrites a floor you set, and counts it", () => {
    const r = planBulkFloors([row({ hasFloor: true }), row({ id: "b" })], 0);
    expect(r.plans.map((p) => p.id)).toEqual(["b"]);
    expect(r.alreadySet).toBe(1);
  });

  it("skips items you do not hold and items with no cost to go on", () => {
    const r = planBulkFloors(
      [row({ held: 0 }), row({ id: "free", avgCostCents: 0 }), row({ id: "ok" })],
      0.1,
    );
    expect(r.plans.map((p) => p.id)).toEqual(["ok"]);
    expect(r.noCost).toBe(1);
  });

  it("flags items whose price is already at or below the new floor", () => {
    const r = planBulkFloors(
      [
        row({ id: "below", priceCents: 900 }),
        row({ id: "at", priceCents: 1000 }),
        row({ id: "above", priceCents: 1001 }),
        row({ id: "nop", priceCents: null, priceCurrency: null }),
        row({ id: "usd", priceCents: 1, priceCurrency: "USD" }),
      ],
      0,
    );
    const alerts = Object.fromEntries(r.plans.map((p) => [p.id, p.alertsNow]));
    expect(alerts).toEqual({ below: true, at: true, above: false, nop: false, usd: false });
  });

  it("makes no plans for a nonsense fraction", () => {
    expect(planBulkFloors([row()], 1).plans).toEqual([]);
    expect(planBulkFloors([row()], -0.1).noCost).toBe(1);
  });
});
