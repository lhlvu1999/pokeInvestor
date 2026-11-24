import { describe, expect, it } from "vitest";
import { sellTargetStanding } from "./sell_target";

const base = {
  targetCents: 3_000_000,
  targetCurrency: "VND",
  priceCents: 2_400_000,
  priceCurrency: "VND",
};

describe("sellTargetStanding", () => {
  it("says how far a price is below the target, as the rise needed", () => {
    const s = sellTargetStanding(base);
    expect(s.state).toBe("below");
    if (s.state !== "below") return;
    expect(s.toGo).toBeCloseTo(0.25, 12); // 2.4M → 3M is +25%
  });

  it("says how far above it a price is once reached", () => {
    const s = sellTargetStanding({ ...base, priceCents: 3_300_000 });
    expect(s.state).toBe("reached");
    if (s.state !== "reached") return;
    expect(s.aboveBy).toBeCloseTo(0.1, 12);
  });

  it("counts exactly the target as reached", () => {
    const s = sellTargetStanding({ ...base, priceCents: 3_000_000 });
    expect(s).toMatchObject({ state: "reached", aboveBy: 0 });
  });

  it("has nothing to say without a target", () => {
    expect(sellTargetStanding({ ...base, targetCents: null })).toEqual({
      state: "none",
    });
    expect(sellTargetStanding({ ...base, targetCents: 0 })).toEqual({
      state: "none",
    });
  });

  it("says when there is no price to compare", () => {
    expect(sellTargetStanding({ ...base, priceCents: null })).toEqual({
      state: "no_price",
    });
    expect(sellTargetStanding({ ...base, priceCents: 0 })).toEqual({
      state: "no_price",
    });
    expect(sellTargetStanding({ ...base, priceCurrency: null })).toEqual({
      state: "no_price",
    });
  });

  it("won't compare different currencies", () => {
    expect(
      sellTargetStanding({ ...base, priceCents: 99, priceCurrency: "USD" }),
    ).toEqual({
      state: "currency_mismatch",
      targetCurrency: "VND",
      priceCurrency: "USD",
    });
  });
});
