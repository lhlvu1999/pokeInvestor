import { describe, expect, it } from "vitest";
import { lastBuyPerUnit, suggestedTotal } from "./entry_hints";

const tx = (o: {
  type?: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  shippingCents?: number | null;
  at: string;
}) => ({
  type: o.type ?? "buy",
  quantity: o.quantity,
  finalValueCents: o.finalValueCents,
  shippingCents: o.shippingCents ?? null,
  occurredAt: new Date(o.at),
});

describe("lastBuyPerUnit", () => {
  it("is null with no buys", () => {
    expect(lastBuyPerUnit([])).toBeNull();
    expect(
      lastBuyPerUnit([
        tx({
          type: "sell",
          quantity: 1,
          finalValueCents: 100,
          at: "2026-01-01",
        }),
      ]),
    ).toBeNull();
  });

  it("uses the most recent buy, not the largest or last in the array", () => {
    expect(
      lastBuyPerUnit([
        tx({ quantity: 2, finalValueCents: 600, at: "2026-03-01" }),
        tx({ quantity: 1, finalValueCents: 100, at: "2026-01-01" }),
        tx({ quantity: 4, finalValueCents: 2000, at: "2026-02-01" }),
      ]),
    ).toBe(300);
  });

  it("ignores later sells", () => {
    expect(
      lastBuyPerUnit([
        tx({ quantity: 2, finalValueCents: 400, at: "2026-01-01" }),
        tx({
          type: "sell",
          quantity: 1,
          finalValueCents: 999,
          at: "2026-02-01",
        }),
      ]),
    ).toBe(200);
  });

  it("excludes shipping, which has its own field", () => {
    expect(
      lastBuyPerUnit([
        tx({
          quantity: 2,
          finalValueCents: 1000,
          shippingCents: 200,
          at: "2026-01-01",
        }),
      ]),
    ).toBe(400);
  });

  it("rounds to a whole minor unit", () => {
    expect(
      lastBuyPerUnit([
        tx({ quantity: 3, finalValueCents: 100, at: "2026-01-01" }),
      ]),
    ).toBe(33);
  });

  it("is null when shipping swallows the whole cost", () => {
    expect(
      lastBuyPerUnit([
        tx({
          quantity: 1,
          finalValueCents: 100,
          shippingCents: 100,
          at: "2026-01-01",
        }),
      ]),
    ).toBeNull();
  });
});

describe("suggestedTotal", () => {
  it("multiplies per-unit by quantity", () => {
    expect(suggestedTotal(250, 4)).toBe(1000);
    expect(suggestedTotal(250, 1)).toBe(250);
  });

  it("is null without a usable price or quantity", () => {
    expect(suggestedTotal(null, 2)).toBeNull();
    expect(suggestedTotal(undefined, 2)).toBeNull();
    expect(suggestedTotal(0, 2)).toBeNull();
    expect(suggestedTotal(250, 0)).toBeNull();
    expect(suggestedTotal(250, 1.5)).toBeNull();
    expect(suggestedTotal(250, Number.NaN)).toBeNull();
  });
});
