import { describe, expect, it } from "vitest";
import { usdCents, usdCompact } from "./usd";

describe("usdCents", () => {
  it("formats cents with separators and two decimals", () => {
    expect(usdCents(0)).toBe("$0.00");
    expect(usdCents(5)).toBe("$0.05");
    expect(usdCents(13352)).toBe("$133.52");
    expect(usdCents(123456789)).toBe("$1,234,567.89");
  });
});

describe("usdCompact", () => {
  it("shortens only large totals", () => {
    expect(usdCompact(99_999)).toBe("$999.99");
    expect(usdCompact(1_234_500)).toBe("$12.3k");
    expect(usdCompact(250_000_000)).toBe("$2.50M");
    expect(usdCompact(2_500_000_000)).toBe("$25.0M");
  });

  it("keeps cents below ten thousand dollars", () => {
    expect(usdCompact(999_999)).toBe("$9,999.99");
  });
});
