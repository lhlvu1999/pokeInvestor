import { describe, expect, it } from "vitest";
import {
  buildSearchQuery,
  ensurePokemonPrefix,
  estimateMarketPrice,
  looksGraded,
  MIN_SAMPLE,
  normalizeProductName,
  type PriceEstimateInput,
} from "./price_estimate";

/** Build inputs from dollar amounts (cents in, per the app's convention). */
const from = (...dollars: number[]): PriceEstimateInput[] =>
  dollars.map((d, i) => ({ totalMinor: Math.round(d * 100), title: `l${i}` }));

describe("estimateMarketPrice — guards", () => {
  it("returns null below the minimum sample size", () => {
    expect(estimateMarketPrice(from(100, 101, 102, 103))).toBeNull();
    expect(from(1, 2, 3, 4).length).toBeLessThan(MIN_SAMPLE);
  });

  it("returns null for an empty set", () => {
    expect(estimateMarketPrice([])).toBeNull();
  });

  it("ignores zero and negative prices", () => {
    // Only 4 valid values remain -> below MIN_SAMPLE.
    expect(estimateMarketPrice(from(0, -5, 100, 101, 102, 103))).toBeNull();
  });

  it("returns null when trimming leaves too few", () => {
    // One tight cluster of 3 plus wildly-separated values; after the
    // median-relative gate too little survives.
    expect(estimateMarketPrice(from(1, 1, 1, 1000, 2000, 3000))).toBeNull();
  });
});

describe("estimateMarketPrice — core behaviour", () => {
  it("takes a low percentile, not the median (asks skew high)", () => {
    const est = estimateMarketPrice(from(100, 110, 120, 130, 140, 150))!;
    expect(est).not.toBeNull();
    // Median would be 12500; p25 is meaningfully below it.
    expect(est.priceMinor).toBeLessThan(12_500);
    expect(est.priceMinor).toBeGreaterThanOrEqual(10_000);
  });

  it("trims high outliers (cases / multi-packs)", () => {
    // Ten genuine ~$145 ETBs plus three $1800 cases of 10.
    const est = estimateMarketPrice(
      from(140, 142, 145, 145, 148, 150, 152, 155, 158, 160, 1800, 1800, 1900),
    )!;
    expect(est.trimmedCount).toBe(3);
    expect(est.keptMaxMinor).toBeLessThan(100_000);
    // Estimate lands in the genuine cluster, not dragged up by the cases.
    expect(est.priceMinor).toBeGreaterThan(14_000);
    expect(est.priceMinor).toBeLessThan(15_500);
  });

  it("trims low outliers (accessories priced far under the product)", () => {
    const est = estimateMarketPrice(
      from(1, 2, 140, 142, 145, 148, 150, 152, 155, 158),
    )!;
    expect(est.trimmedCount).toBe(2);
    expect(est.keptMinMinor).toBeGreaterThanOrEqual(14_000);
  });

  it("reports zero dispersion when every listing agrees", () => {
    const est = estimateMarketPrice(from(100, 100, 100, 100, 100, 100))!;
    expect(est.dispersion).toBe(0);
    expect(est.priceMinor).toBe(10_000);
  });
});

describe("estimateMarketPrice — confidence grading", () => {
  it("grades a large, tight, untrimmed sample as high", () => {
    // 24 listings clustered within a few percent.
    const vals = Array.from({ length: 24 }, (_, i) => 145 + (i % 5));
    const est = estimateMarketPrice(from(...vals))!;
    expect(est.confidence).toBe("high");
  });

  it("grades a small sample as low even when tight", () => {
    const est = estimateMarketPrice(from(145, 146, 147, 148, 149, 150))!;
    // 6 listings is not enough to be confident regardless of tightness.
    expect(est.confidence).toBe("low");
  });

  it("grades a heavily-trimmed sample as low", () => {
    // 12 genuine + 10 wild outliers -> trim ratio ~45%.
    const genuine = Array.from({ length: 12 }, (_, i) => 145 + i);
    const junk = Array.from({ length: 10 }, () => 5000);
    const est = estimateMarketPrice(from(...genuine, ...junk))!;
    expect(est.trimmedCount).toBe(10);
    expect(est.confidence).toBe("low");
  });
});

describe("estimateMarketPrice — real-world regression", () => {
  /**
   * Actual prices observed from the eBay Browse API for the query
   * "Prismatic Evolutions Elite Trainer Box" with NO negative keywords.
   * The cheap end is live code cards, ETB dice, and the player's guide
   * book — not the product. A plain median over this set returns ~$14
   * for a product that sells for ~$145.
   *
   * This documents that the estimator ALONE cannot rescue a bad query:
   * the negative-keyword filtering at the API layer is load-bearing.
   */
  const contaminated = from(
    0.99,
    1.0,
    1.99,
    3.37,
    3.37,
    4.99,
    5.0,
    7.0,
    8.0,
    8.98,
    8.98,
    8.99,
    9.5,
    10.0,
    11.0,
    12.0,
    13.0,
    14.24,
    15.0,
    18.0,
    22.0,
    30.0,
    45.0,
    139.99,
    145.0,
    145.98,
  );

  it("flags a contaminated result set as low confidence", () => {
    const est = estimateMarketPrice(contaminated)!;
    expect(est).not.toBeNull();
    // The gate keeps the *accessory* cluster (it is the bulk of the set)
    // and trims the genuine product as a high outlier, so the estimate is
    // badly wrong (~$9 for a ~$145 product). The estimator cannot know
    // that — but it CAN see that it threw away a third of its sample.
    expect(est.trimmedCount / est.sampleSize).toBeGreaterThan(0.3);
    expect(est.confidence).toBe("low");
  });

  /**
   * The same query WITH negative keywords + category filter, as the
   * provider actually issues it. Genuine ETBs plus three cases of 10.
   */
  const clean = from(
    140.0,
    140.0,
    144.99,
    144.99,
    145.0,
    145.0,
    145.0,
    145.0,
    147.0,
    148.49,
    149.99,
    150.0,
    152.0,
    155.0,
    155.0,
    158.0,
    160.0,
    162.0,
    165.74,
    168.0,
    170.0,
    175.0,
    180.0,
    430.0,
    1799.88,
    1799.95,
    1899.99,
  );

  it("prices the filtered set near the real street price", () => {
    const est = estimateMarketPrice(clean)!;
    // Cases of 10 are trimmed; the $430 graded variant survives but p25
    // sidesteps it.
    expect(est.trimmedCount).toBe(3);
    // Street price for this ETB was ~$140-150 at time of capture.
    expect(est.priceMinor).toBeGreaterThan(14_000);
    expect(est.priceMinor).toBeLessThan(15_500);
  });
});

describe("buildSearchQuery", () => {
  it("appends negative keywords", () => {
    const q = buildSearchQuery("Prismatic Evolutions ETB", ["code", "dice"]);
    expect(q).toBe("Pokemon Prismatic Evolutions ETB -code -dice");
  });

  it("collapses whitespace in the product name", () => {
    expect(buildSearchQuery("  Foo   Bar  ", [])).toBe("Pokemon Foo Bar");
  });

  it("returns the bare name when there are no negatives", () => {
    expect(buildSearchQuery("Foo Bar", [])).toBe("Pokemon Foo Bar");
  });

  it("uses the default negative list when none is given", () => {
    const q = buildSearchQuery("Foo");
    expect(q).toContain("-code");
    expect(q).toContain("-dice");
    // `-case` is deliberately excluded — "case fresh" is a legit phrase.
    expect(q).not.toContain("-case");
  });

  describe("self-exclusion guard", () => {
    /**
     * Regression: `-bundle` returned ZERO eBay results for "Prismatic
     * Evolutions Booster Bundle" (~1400 genuine listings) because the
     * negative excluded the product by its own name.
     */
    it("drops a negative that appears in the product name", () => {
      const q = buildSearchQuery("Prismatic Evolutions Booster Bundle");
      expect(q).not.toContain("-bundle");
      // Unrelated negatives still apply.
      expect(q).toContain("-dice");
    });

    it("matches whole words only, case-insensitively", () => {
      // "Bundle" capitalised in the name still suppresses "-bundle".
      expect(buildSearchQuery("Booster Bundle", ["bundle"])).toBe(
        "Pokemon Booster Bundle",
      );
      // "coinage" must NOT suppress "-coin" (no word-boundary match).
      expect(buildSearchQuery("Coinage Set", ["coin"])).toBe(
        "Pokemon Coinage Set -coin",
      );
    });

    it("returns the bare name when every negative collides", () => {
      expect(buildSearchQuery("Dice Guide", ["dice", "guide"])).toBe(
        "Pokemon Dice Guide",
      );
    });
  });
});

describe("looksGraded", () => {
  it.each([
    "slab flareon psa10",
    "slab pikachu psa 10 160 crown",
    "Charizard BGS 9.5",
    "Umbreon CGC 10",
    "Graded Blastoise",
  ])("detects %s as graded", (n) => {
    expect(looksGraded(n)).toBe(true);
  });

  it.each([
    "Prismatic Evolutions Elite Trainer Box",
    "Chaos Rising Booster Box",
    "Surging Sparks Booster Bundle",
  ])("treats %s as sealed", (n) => {
    expect(looksGraded(n)).toBe(false);
  });

  it("reads tags as well as the name", () => {
    expect(looksGraded("Oricorio jp", ["slab"])).toBe(true);
    expect(looksGraded("Oricorio jp", ["etb"])).toBe(false);
  });

  it("matches whole words only", () => {
    // "psalm" must not trip the "psa" grader check.
    expect(looksGraded("Psalm Book Promo")).toBe(false);
  });
});

describe("normalizeProductName", () => {
  it("spaces a grader from its number", () => {
    expect(normalizeProductName("flareon psa10")).toBe("flareon psa 10");
    expect(normalizeProductName("Charizard BGS9.5")).toBe("Charizard BGS 9.5");
  });

  it("strips collector jargon absent from listing titles", () => {
    // Regression: "slab" alone cut 2,687 matches down to 9.
    expect(normalizeProductName("slab flareon psa10")).toBe("flareon psa 10");
    expect(normalizeProductName("Graded Blastoise")).toBe("Blastoise");
  });

  it("leaves ordinary product names untouched", () => {
    expect(normalizeProductName("Prismatic Evolutions Booster Bundle")).toBe(
      "Prismatic Evolutions Booster Bundle",
    );
  });

  it("falls back to the original when stripping empties the name", () => {
    expect(normalizeProductName("slab graded")).toBe("slab graded");
  });

  it("feeds through buildSearchQuery", () => {
    const q = buildSearchQuery("slab flareon psa10");
    expect(q.startsWith("Pokemon flareon psa 10")).toBe(true);
    expect(q).not.toContain("slab");
  });
});

describe("ensurePokemonPrefix", () => {
  it("prepends the brand when absent", () => {
    expect(ensurePokemonPrefix("Stacking Tin 2025")).toBe(
      "Pokemon Stacking Tin 2025",
    );
    expect(ensurePokemonPrefix("slab psa 10 Flareon ex")).toBe(
      "Pokemon slab psa 10 Flareon ex",
    );
  });

  it("leaves names that already mention Pokemon alone", () => {
    expect(ensurePokemonPrefix("Pokemon Go Elite Trainer Box")).toBe(
      "Pokemon Go Elite Trainer Box",
    );
  });

  it("accepts the accented spelling", () => {
    // Official product names use "Pokémon"; that already scopes the search.
    expect(ensurePokemonPrefix("Pokémon Day 2026 Collection Box")).toBe(
      "Pokémon Day 2026 Collection Box",
    );
  });

  it("is case-insensitive", () => {
    expect(ensurePokemonPrefix("POKEMON 151 Booster Box")).toBe(
      "POKEMON 151 Booster Box",
    );
  });

  it("does not duplicate when the word appears mid-name", () => {
    // Already scoped — prefixing would just repeat the term.
    expect(ensurePokemonPrefix("Chaos Rising Pokemon Elite Trainer Box")).toBe(
      "Chaos Rising Pokemon Elite Trainer Box",
    );
  });

  it("matches whole words only", () => {
    // "Pokemonster" is not the brand.
    expect(ensurePokemonPrefix("Pokemonster Deck")).toBe(
      "Pokemon Pokemonster Deck",
    );
  });

  it("handles an empty name without producing a bare prefix", () => {
    expect(ensurePokemonPrefix("   ")).toBe("");
  });

  it("applies through buildSearchQuery, after jargon stripping", () => {
    const q = buildSearchQuery("slab flareon psa10");
    // "slab" stripped, grader spaced, brand prepended.
    expect(q.startsWith("Pokemon flareon psa 10")).toBe(true);
  });
});
