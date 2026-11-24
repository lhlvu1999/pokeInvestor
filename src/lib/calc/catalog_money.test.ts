import { describe, expect, it } from "vitest";
import {
  convertUsdCents,
  describeFx,
  showUsd,
  usable,
  type Fx,
} from "./catalog_money";

const VND: Fx = {
  currency: "VND",
  rate: 25_779.2,
  asOf: "2026-11-23T00:59:03Z",
  stale: false,
};
const EUR: Fx = {
  currency: "EUR",
  rate: 0.911134,
  asOf: "2026-11-23T00:59:03Z",
  stale: false,
};

describe("usable", () => {
  it("accepts a real rate for a non-dollar currency", () => {
    expect(usable(VND)).toBe(true);
  });
  it("rejects no rate, a dollar 'conversion' and nonsense rates", () => {
    expect(usable(null)).toBe(false);
    expect(usable({ ...VND, currency: "USD", rate: 1 })).toBe(false);
    for (const rate of [0, -3, NaN, Infinity])
      expect(usable({ ...VND, rate })).toBe(false);
  });
});

describe("convertUsdCents", () => {
  it("converts dollars to whole VND", () => {
    // $151.79 × 25,779.2 = 3,913,024.77, rounded to the nearest dong
    expect(convertUsdCents(15_179, VND)).toBe(3_913_025);
  });

  it("keeps cents for a currency that has them", () => {
    // $100.00 × 0.911134 = €91.11
    expect(convertUsdCents(10_000, EUR)).toBe(9_111);
  });

  it("is zero for zero and rounds to the nearest unit", () => {
    expect(convertUsdCents(0, VND)).toBe(0);
    expect(convertUsdCents(1, VND)).toBe(258); // $0.01 = ₫257.79, rounded up
  });

  it("is null when there is nothing usable to convert with", () => {
    expect(convertUsdCents(1000, null)).toBeNull();
    expect(convertUsdCents(1000, { ...VND, rate: 0 })).toBeNull();
    expect(
      convertUsdCents(1000, { ...VND, currency: "USD", rate: 1 }),
    ).toBeNull();
  });

  it("handles very large totals without losing whole units", () => {
    // $4,343.73 and $1,000,000.00
    expect(convertUsdCents(434_373, VND)).toBe(111_977_884);
    expect(convertUsdCents(100_000_000, VND)).toBe(25_779_200_000);
  });
});

describe("showUsd", () => {
  it("leads with the converted amount and keeps the dollars beside it", () => {
    expect(showUsd(15_179, VND)).toEqual({
      primary: "₫3,913,025",
      secondary: "$151.79",
      converted: true,
    });
  });

  it("shortens big numbers in compact form", () => {
    const s = showUsd(434_373, VND, true);
    expect(s.primary).toBe("₫112M");
    expect(s.secondary).toBe("$4,343.73");
  });

  it("shows only dollars when there is no rate", () => {
    expect(showUsd(15_179, null)).toEqual({
      primary: "$151.79",
      secondary: null,
      converted: false,
    });
  });

  it("shows only dollars when the target is dollars", () => {
    expect(showUsd(15_179, { ...VND, currency: "USD", rate: 1 })).toEqual({
      primary: "$151.79",
      secondary: null,
      converted: false,
    });
  });

  it("never converts with a broken rate", () => {
    expect(showUsd(15_179, { ...VND, rate: NaN }).converted).toBe(false);
    expect(showUsd(15_179, { ...VND, rate: -1 }).primary).toBe("$151.79");
  });

  it("formats a currency with cents in that currency", () => {
    const s = showUsd(10_000, EUR);
    expect(s.primary).toBe("€91.11");
    expect(s.secondary).toBe("$100.00");
  });

  it("handles zero", () => {
    expect(showUsd(0, VND).primary).toBe("₫0");
  });
});

describe("describeFx", () => {
  it("says what rate and day the conversion used", () => {
    expect(describeFx(VND)).toBe(
      "Converted from US dollars at ₫25,779 per $1 (rate from Nov 23, 2026).",
    );
  });

  it("shows a rate below one correctly for a currency with cents", () => {
    expect(describeFx(EUR)).toBe(
      "Converted from US dollars at €0.91 per $1 (rate from Nov 23, 2026).",
    );
  });

  it("owns up to an old rate", () => {
    expect(describeFx({ ...VND, stale: true })).toContain("an older rate");
  });

  it("explains itself when there is no rate", () => {
    expect(describeFx(null)).toContain("no exchange rate is available");
    expect(describeFx(null, "VND")).toContain("no exchange rate is available");
  });

  it("does not claim a rate is missing when the display currency is already dollars", () => {
    const text = describeFx(null, "USD");
    expect(text).not.toContain("no exchange rate");
    expect(text).toContain("US dollars");
  });
});
