import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPARE,
  MAX_COMPARE,
  compareHref,
  parseCompareParams,
  parseSetIds,
} from "./compare_params";

describe("parseSetIds", () => {
  it("reads a comma list, dropping bad, duplicate and out-of-range ids", () => {
    expect(parseSetIds("24541, 24831,abc,-4,0,24541,3.5,99999999999")).toEqual([
      24541, 24831,
    ]);
    expect(parseSetIds(undefined)).toEqual([]);
    expect(parseSetIds("")).toEqual([]);
  });
  it("keeps at most five, in order", () => {
    expect(parseSetIds("1,2,3,4,5,6,7")).toEqual([1, 2, 3, 4, 5]);
    expect(MAX_COMPARE).toBe(5);
  });
});

describe("parseCompareParams", () => {
  it("defaults when nothing is given", () => {
    expect(parseCompareParams({})).toEqual(DEFAULT_COMPARE);
  });
  it("reads valid choices and falls back on bad ones", () => {
    expect(
      parseCompareParams({ sets: "5,6", card: "total", base: "30", band: "off", q: " ascended " }),
    ).toEqual({ sets: [5, 6], q: "ascended", card: "total", base: 30, band: false });
    expect(parseCompareParams({ card: "x", base: "9", band: "maybe" })).toEqual(
      DEFAULT_COMPARE,
    );
  });
  it("trims a long search and uses the first of a repeated parameter", () => {
    expect(parseCompareParams({ q: "x".repeat(200) }).q).toHaveLength(60);
    expect(parseCompareParams({ card: ["top10", "total"] }).card).toBe("top10");
  });
});

describe("compareHref", () => {
  it("is the bare page for the defaults", () => {
    expect(compareHref(DEFAULT_COMPARE, {})).toBe("/catalog/compare");
  });
  it("keeps the other choices and drops ones set back to default", () => {
    const cur = { ...DEFAULT_COMPARE, sets: [1, 2], card: "top10" as const, band: false };
    expect(compareHref(cur, { base: 30 })).toBe(
      "/catalog/compare?sets=1%2C2&card=top10&base=30&band=off",
    );
    expect(compareHref(cur, { card: "top20", band: true, sets: [] })).toBe(
      "/catalog/compare",
    );
  });
  it("carries a search along", () => {
    expect(compareHref(DEFAULT_COMPARE, { q: "ascended" })).toBe(
      "/catalog/compare?q=ascended",
    );
  });
});
