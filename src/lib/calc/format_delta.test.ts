import { describe, expect, it } from "vitest";
import { pct, signed, tone } from "./format_delta";

describe("format_delta", () => {
  it("signs money with a real minus", () => {
    expect(signed(1000, "VND")).toBe("+₫1,000");
    expect(signed(-1000, "VND")).toBe("−₫1,000");
    expect(signed(0, "VND")).toBe("₫0");
  });
  it("signs percentages to one decimal", () => {
    expect(pct(0.123)).toBe("+12.3%");
    expect(pct(-0.04)).toBe("−4.0%");
    expect(pct(0)).toBe("0.0%");
  });
  it("colours gains and losses only", () => {
    expect(tone(1)).toContain("emerald");
    expect(tone(-1)).toContain("rose");
    expect(tone(0)).toBe("");
  });
});
