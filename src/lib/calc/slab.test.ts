import { describe, expect, it } from "vitest";
import {
  escapeLike,
  gradeLabel,
  isSlabName,
  overallPremium,
  parseGrade,
  premium,
  ratioLabel,
  searchTokens,
  slabSearchHint,
  summarizeSlabs,
} from "./slab";

describe("isSlabName", () => {
  it("recognises slabs the way the pipeline does", () => {
    for (const n of [
      "slab psa 10 Charizard ex 331/190 jp",
      "psa 10 Pikachu",
      "PSA10 Eevee",
      "slab tag 10 oricorio ex 024",
      "bgs 9.5 Mewtwo",
      "Charizard cgc 9",
    ]) {
      expect(isSlabName(n)).toBe(true);
    }
  });
  it("does not take sealed products for slabs", () => {
    expect(isSlabName("Stellar Crown Booster Box")).toBe(false);
    expect(isSlabName("Pokemon Go Elite Trainer Box")).toBe(false);
    expect(isSlabName("Tag Team Collection")).toBe(false);
  });
  it("honours a slab tag", () => {
    expect(isSlabName("Some card", ["slab"])).toBe(true);
    expect(isSlabName("Some card", ["promo"])).toBe(false);
  });
});

describe("parseGrade", () => {
  it("reads the grader and grade", () => {
    expect(parseGrade("slab psa 10 Charizard")).toEqual({ grader: "PSA", grade: "10" });
    expect(parseGrade("slab psa10 pikachu")).toEqual({ grader: "PSA", grade: "10" });
    expect(parseGrade("bgs 9.5 mewtwo")).toEqual({ grader: "BGS", grade: "9.5" });
    expect(parseGrade("slab tag 10 oricorio")).toEqual({ grader: "TAG", grade: "10" });
  });
  it("is null when there is no grade", () => {
    expect(parseGrade("Stellar Crown Booster Box")).toBeNull();
    expect(parseGrade("slab Charizard")).toBeNull();
  });
  it("labels it", () => {
    expect(gradeLabel({ grader: "PSA", grade: "9" })).toBe("PSA 9");
    expect(gradeLabel(null)).toBe("Graded");
  });
});

describe("premium", () => {
  it("is the ratio and the difference", () => {
    expect(premium(300, 100)).toEqual({ ratio: 3, diff: 200 });
    expect(premium(50, 100)).toEqual({ ratio: 0.5, diff: -50 });
  });
  it("needs both values and a positive raw price", () => {
    expect(premium(null, 100)).toBeNull();
    expect(premium(100, null)).toBeNull();
    expect(premium(100, 0)).toBeNull();
    expect(premium(0, 100)).toBeNull();
    expect(premium(undefined, undefined)).toBeNull();
  });
});

describe("summarizeSlabs", () => {
  const rows = [
    { qty: 1, slabEach: 300, rawEach: 100 }, // comparable
    { qty: 2, slabEach: 200, rawEach: 50 }, // comparable
    { qty: 1, slabEach: null, rawEach: 80 }, // not priced
    { qty: 1, slabEach: 500, rawEach: null }, // not matched
  ];
  it("counts what can and cannot be compared", () => {
    const s = summarizeSlabs(rows);
    expect(s.slabs).toBe(4);
    expect(s.units).toBe(5);
    expect(s.unpriced).toBe(1);
    expect(s.unmatched).toBe(1);
    expect(s.comparable).toBe(2);
  });
  it("sums slab value, raw value and the comparable part separately", () => {
    const s = summarizeSlabs(rows);
    expect(s.slabValue).toBe(300 + 400 + 500);
    expect(s.rawValue).toBe(100 + 100 + 80);
    expect(s.comparableSlab).toBe(700);
    expect(s.comparableRaw).toBe(200);
  });
  it("gives an overall premium over the comparable slabs only", () => {
    expect(overallPremium(summarizeSlabs(rows))?.ratio).toBe(3.5);
    expect(overallPremium(summarizeSlabs([]))).toBeNull();
    expect(overallPremium(summarizeSlabs([{ qty: 1, slabEach: 5, rawEach: null }]))).toBeNull();
  });
});

describe("ratioLabel", () => {
  it("shows one decimal below ten", () => {
    expect(ratioLabel(2.44)).toBe("2.4×");
    expect(ratioLabel(0.5)).toBe("0.5×");
    expect(ratioLabel(12.6)).toBe("13×");
  });
});

describe("finding a card by hand", () => {
  it("starts from the name without grader, grade or language", () => {
    expect(slabSearchHint("slab psa 10 Eevee 173 jp")).toBe("eevee 173");
    expect(slabSearchHint("slab psa10 pikachu VMax 265/S-P jp")).toBe("pikachu vmax 265/s-p");
    expect(slabSearchHint("slab tag 10 oricorio ex 024")).toBe("oricorio ex 024");
    expect(slabSearchHint("psa 9 squirtle 148/142")).toBe("squirtle 148/142");
  });
  it("splits a query into safe words", () => {
    expect(searchTokens("  Charizard   ex 331/190 ")).toEqual(["charizard", "ex", "331/190"]);
    expect(searchTokens("n's reshiram")).toEqual(["n's", "reshiram"]);
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens("a b c d e f g h")).toHaveLength(6);
    expect(searchTokens("x'; DROP TABLE items;--")).toEqual(["x'", "drop", "table", "items--"]);
  });
  it("makes LIKE wildcards literal", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
    expect(escapeLike("plain")).toBe("plain");
  });
});
