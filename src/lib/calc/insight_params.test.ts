import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSIGHT_PARAMS,
  insightHref,
  parseInsightParams,
} from "./insight_params";

describe("parseInsightParams", () => {
  it("defaults when nothing is given", () => {
    expect(parseInsightParams({})).toEqual(DEFAULT_INSIGHT_PARAMS);
  });

  it("reads valid choices", () => {
    expect(
      parseInsightParams({ metric: "set_top20", kind: "etb", base: "30" }),
    ).toEqual({
      ...DEFAULT_INSIGHT_PARAMS,
      metric: "set_top20",
      kind: "etb",
      base: 30,
    });
  });

  it("falls back on anything it doesn't recognise", () => {
    expect(
      parseInsightParams({ metric: "nope", kind: "tin", base: "12" }),
    ).toEqual(DEFAULT_INSIGHT_PARAMS);
    expect(parseInsightParams({ base: "-7" }).base).toBe(0);
    expect(parseInsightParams({ base: "7.5" }).base).toBe(0);
    expect(parseInsightParams({ base: "" }).base).toBe(0);
    expect(parseInsightParams({ metric: "__proto__" }).metric).toBe(
      DEFAULT_INSIGHT_PARAMS.metric,
    );
  });

  it("reads the card choices and falls back on bad ones", () => {
    expect(parseInsightParams({ card: "total", cbase: "30" })).toMatchObject({
      card: "total",
      cbase: 30,
    });
    expect(parseInsightParams({ card: "top5", cbase: "9" })).toMatchObject({
      card: "top20",
      cbase: 14,
    });
    expect(parseInsightParams({ cbase: "7" }).cbase).toBe(7);
  });

  it("uses the first of a repeated parameter", () => {
    expect(parseInsightParams({ kind: ["pack", "box"] }).kind).toBe("pack");
  });
});

describe("insightHref", () => {
  it("is the bare page for the defaults", () => {
    expect(insightHref(DEFAULT_INSIGHT_PARAMS, {})).toBe("/catalog/insights");
  });

  it("changes one choice and keeps the others", () => {
    const cur = { ...DEFAULT_INSIGHT_PARAMS, kind: "etb" as const, base: 7 };
    expect(insightHref(cur, { metric: "pack" })).toBe(
      "/catalog/insights?metric=pack&kind=etb&base=7",
    );
  });

  it("keeps the card choices in the link", () => {
    const cur = { ...DEFAULT_INSIGHT_PARAMS, card: "top10" as const, cbase: 30 };
    expect(insightHref(cur, { kind: "pack" })).toBe(
      "/catalog/insights?kind=pack&card=top10&cbase=30",
    );
    expect(insightHref(cur, { card: "top20", cbase: 14 })).toBe(
      "/catalog/insights",
    );
  });

  it("drops a choice that is set back to its default", () => {
    const cur = { ...DEFAULT_INSIGHT_PARAMS, base: 30 };
    expect(insightHref(cur, { base: 0 })).toBe("/catalog/insights");
  });
});
