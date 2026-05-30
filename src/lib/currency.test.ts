import { describe, expect, it } from "vitest";
import {
  convertMinor,
  formatAmount,
  isSupportedCurrency,
  minorToDecimalString,
  parseAmount,
} from "./currency";

describe("parseAmount", () => {
  it.each([
    ["18.50", "USD", 1850],
    ["18", "USD", 1800],
    ["0", "USD", 0],
    ["1,234.56", "USD", 123_456],
    ["-12.34", "USD", -1234],
    ["1850", "VND", 1850],
    ["-500", "VND", -500],
    ["120000", "JPY", 120_000],
  ])("parses %s %s -> %d", (input, currency, expected) => {
    expect(parseAmount(input, currency)).toBe(expected);
  });

  it("rejects fractional VND", () => {
    expect(() => parseAmount("18.50", "VND")).toThrow();
  });

  it("rejects more decimals than the currency allows", () => {
    expect(() => parseAmount("18.501", "USD")).toThrow();
  });

  it("rejects unsupported currency", () => {
    expect(() => parseAmount("1", "XYZ")).toThrow();
  });
});

describe("minorToDecimalString", () => {
  it.each([
    [1850, "USD", "18.50"],
    [1850, "VND", "1850"],
    [-1234, "USD", "-12.34"],
    [0, "VND", "0"],
  ])("formats %d %s -> %s", (input, currency, expected) => {
    expect(minorToDecimalString(input, currency)).toBe(expected);
  });
});

describe("formatAmount", () => {
  it("formats USD with two decimals", () => {
    expect(formatAmount(1850, "USD")).toMatch(/\$18\.50/);
  });
  it("formats VND with no decimals", () => {
    const out = formatAmount(1_850_000, "VND");
    expect(out).not.toMatch(/\./);
    expect(out).toMatch(/1[\.,]850[\.,]000/);
  });
});

describe("convertMinor", () => {
  it("returns the same amount when from === to", () => {
    expect(convertMinor(1850, "USD", "USD", 1.5)).toBe(1850);
  });

  it("converts USD -> VND with proper scaling", () => {
    // 100 USD = 10000 minor; rate 25,000 VND/USD; expected 2,500,000 VND minor
    expect(convertMinor(10_000, "USD", "VND", 25_000)).toBe(2_500_000);
  });

  it("converts VND -> USD with proper scaling", () => {
    // 25,000 VND = 25000 minor; rate 0.00004 USD/VND; expected 1.00 USD = 100 cents
    expect(convertMinor(25_000, "VND", "USD", 0.00004)).toBe(100);
  });
});

describe("isSupportedCurrency", () => {
  it("recognizes supported codes", () => {
    expect(isSupportedCurrency("VND")).toBe(true);
    expect(isSupportedCurrency("USD")).toBe(true);
  });
  it("rejects unsupported codes", () => {
    expect(isSupportedCurrency("XYZ")).toBe(false);
  });
});
