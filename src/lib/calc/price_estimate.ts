/**
 * Robust market-price estimation from a set of eBay *asking* prices.
 *
 * ── Why this is not just a median ──────────────────────────────────────
 * eBay's full-text search returns anything whose title mentions the
 * product. A search for "Prismatic Evolutions Elite Trainer Box" returns,
 * in ascending price order: live code cards ($0.99), ETB dice ($5-9), the
 * player's guide book ($5), single cards, then finally the actual sealed
 * ETB (~$140), and above that cases of 10 ETBs (~$1800).
 *
 * A naive median over that raw set gives ~$14 — off by 10x. So we:
 *   1. Reject outliers relative to the median (drops multi-packs/cases at
 *      the top and accessories at the bottom).
 *   2. Take a LOW percentile of what survives. These are *asks*, not
 *      solds; sellers list optimistically and many listings never clear.
 *      The cheap end of the genuine-product cluster is closer to what you
 *      would actually realize.
 *
 * ── Confidence ────────────────────────────────────────────────────────
 * The estimate is only as good as the search. A product that doesn't
 * exist still returns hundreds of loosely-matching listings and yields a
 * plausible-looking number. We therefore return a confidence score
 * derived from sample size and how much had to be trimmed, so callers can
 * refuse to overwrite good data with a bad guess.
 */

/** Outlier gate: keep prices within [median / K, median * K]. */
const OUTLIER_FACTOR = 3;
/** Percentile of the surviving set used as the estimate. */
const ESTIMATE_PERCENTILE = 0.25;
/** Below this many usable listings we don't produce an estimate at all. */
export const MIN_SAMPLE = 5;

export type PriceEstimateInput = {
  /** Total cost to the buyer in minor units (price + shipping). */
  totalMinor: number;
  /** Listing title — retained for the audit trail / UI preview. */
  title: string;
};

export type EstimateConfidence = "high" | "medium" | "low";

export type PriceEstimate = {
  /** The estimate, in the same minor units as the input. */
  priceMinor: number;
  /** How many listings were usable before trimming. */
  sampleSize: number;
  /** How many were rejected as outliers. */
  trimmedCount: number;
  /** Interquartile range of the kept set / median. 0 = all identical.
   * High dispersion means the search matched a mix of products. */
  dispersion: number;
  confidence: EstimateConfidence;
  /** Cheapest and dearest of the *kept* set — shown in the preview so a
   * human can eyeball whether the search matched the right product. */
  keptMinMinor: number;
  keptMaxMinor: number;
};

/** Linear-interpolated percentile over a pre-sorted ascending array. */
function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const k = (sorted.length - 1) * p;
  const lo = Math.floor(k);
  if (lo + 1 >= sorted.length) return sorted[lo];
  return sorted[lo] + (sorted[lo + 1] - sorted[lo]) * (k - lo);
}

function median(sorted: ReadonlyArray<number>): number {
  return percentile(sorted, 0.5);
}

/**
 * Grade the estimate. Two independent things can go wrong:
 *   - Too few listings → the percentile is noise.
 *   - Too many trimmed / too dispersed → the query matched a grab-bag of
 *     different products, so even the surviving cluster is suspect.
 */
function grade(
  sampleSize: number,
  trimmedCount: number,
  dispersion: number,
): EstimateConfidence {
  const trimRatio = sampleSize === 0 ? 1 : trimmedCount / sampleSize;
  if (sampleSize >= 20 && trimRatio <= 0.15 && dispersion <= 0.35) {
    return "high";
  }
  // The medium bar is deliberately tight on trimRatio. Calibrated against
  // a real contaminated capture (accessories + codes + the actual product
  // in one result set) which trimmed 34.6% and produced an estimate 15x
  // below the true price. Anything trimming more than a quarter of its
  // sample is matching multiple distinct products and must not be trusted
  // enough to overwrite a price automatically.
  if (sampleSize >= 10 && trimRatio <= 0.25 && dispersion <= 0.5) {
    return "medium";
  }
  return "low";
}

/**
 * Estimate a market price from asking-price listings. Returns null when
 * there isn't enough signal to justify any number at all — callers should
 * surface that as "couldn't price this" rather than inventing a value.
 */
export function estimateMarketPrice(
  listings: ReadonlyArray<PriceEstimateInput>,
): PriceEstimate | null {
  const values = listings
    .map((l) => l.totalMinor)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (values.length < MIN_SAMPLE) return null;

  const med = median(values);
  if (med <= 0) return null;

  const lower = med / OUTLIER_FACTOR;
  const upper = med * OUTLIER_FACTOR;
  const kept = values.filter((v) => v >= lower && v <= upper);
  if (kept.length < MIN_SAMPLE) return null;

  const keptMedian = median(kept);
  const iqr = percentile(kept, 0.75) - percentile(kept, 0.25);
  const dispersion = keptMedian > 0 ? iqr / keptMedian : 0;

  return {
    priceMinor: Math.round(percentile(kept, ESTIMATE_PERCENTILE)),
    sampleSize: values.length,
    trimmedCount: values.length - kept.length,
    dispersion,
    confidence: grade(values.length, values.length - kept.length, dispersion),
    keptMinMinor: kept[0],
    keptMaxMinor: kept[kept.length - 1],
  };
}

/**
 * Default negative keywords appended to a product search. These are the
 * accessory/derivative listings that pollute a Pokémon sealed-product
 * search — codes, dice, guides, and multi-packs.
 *
 * Deliberately NOT including `-case`: plenty of legitimate listings say
 * "case fresh" or "factory case". Cases of 10 are instead caught by the
 * outlier gate, which is more robust than keyword whack-a-mole.
 */
export const DEFAULT_NEGATIVE_KEYWORDS = [
  // Digital / paper derivatives sold under the product's name.
  "code",
  "codes",
  // Accessories that ship inside the box and get parted out. eBay matches
  // whole words and does NOT stem, so singular AND plural are both needed
  // — a "-sleeves" filter does not exclude a "DECK SLEEVE" listing.
  "dice",
  "die",
  "sleeve",
  "sleeves",
  "divider",
  "dividers",
  "coin",
  "guide",
  "playmat",
  "binder",
  "toploader",
  // Display/protection accessories whose titles name the product they
  // "FIT" — e.g. "Acrylic Display Case Stackable FITS POKEMON <product>
  // ETB". These undercut the real product and drag the percentile down.
  // Note we exclude "acrylic"/"protector"/"stackable" rather than "case",
  // since "case fresh" and "factory case" are legitimate phrases.
  "acrylic",
  "protector",
  "protectors",
  "stackable",
  // Opened / incomplete.
  "empty",
  "opened",
  // Multi-item listings that price per-lot, not per-unit.
  "promo",
  "bundle",
  "lot",
] as const;

/**
 * Heuristic: does this item look like a graded/slabbed single rather than
 * sealed product?
 *
 * Matters because the eBay search applies `conditions:{NEW}` by default,
 * which is right for sealed boxes but excludes essentially every graded
 * slab — they are listed as Used or with no condition set. Without this a
 * bulk refresh can never price a slab at all.
 */
export function looksGraded(
  name: string,
  tags: ReadonlyArray<string> = [],
): boolean {
  const haystack = `${name} ${tags.join(" ")}`.toLowerCase();
  return /\b(slab|slabbed|graded|psa|bgs|cgc|sgc)\b/.test(haystack);
}

/**
 * Collector jargon that essentially never appears in an eBay listing
 * title. Leaving these in the query is catastrophic, not merely noisy:
 * "slab flareon psa10" returns 9 listings where "flareon psa 10" returns
 * 2,687 — the word "slab" alone drops ~99.5% of the market.
 */
const QUERY_STOPWORDS = new Set(["slab", "slabbed", "graded", "sealed"]);

/**
 * Make a user's item name searchable on eBay.
 *
 *  - Puts a space between a grader and its number ("psa10" -> "psa 10"),
 *    which is how sellers actually write it (+~50% more matches).
 *  - Drops collector jargon that no seller puts in a title.
 *
 * Applied only to the *search*; the original name is still what grading
 * detection and the UI use.
 */
export function normalizeProductName(name: string): string {
  const spaced = name.replace(
    /\b(psa|bgs|cgc|sgc)\s*(10|\d(?:\.\d)?)\b/gi,
    "$1 $2",
  );
  const kept = spaced
    .split(/\s+/)
    .filter((w) => w && !QUERY_STOPWORDS.has(w.toLowerCase()));
  // If stripping left nothing meaningful, fall back to the original so we
  // search *something* rather than an empty string.
  const out = kept.join(" ").trim();
  return out.length > 0 ? out : name.trim().replace(/\s+/g, " ");
}

/**
 * Matches "pokemon" or "Pokémon" as a whole word, any case. The accented
 * spelling is common in official product names ("Pokémon Day 2026
 * Collection Box"), so both must count as already-scoped.
 */
const POKEMON_WORD = /\bpok[eé]mon\b/i;

/**
 * Scope a search to Pokémon listings.
 *
 * Many item names are set-specific but brand-agnostic ("Stacking Tin
 * 2025", "slab psa 10 Flareon ex 202/187 JP") and match other TCGs or
 * unrelated collectibles on their own. Prefixing the brand narrows the
 * result set to the right market.
 *
 * Checks for the word ANYWHERE, not just at the start — "Chaos Rising
 * Pokemon Elite Trainer Box" is already scoped, and prepending would
 * only duplicate the term.
 */
export function ensurePokemonPrefix(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return POKEMON_WORD.test(trimmed) ? trimmed : `Pokemon ${trimmed}`;
}

/**
 * Build the `q` parameter: the normalized, brand-scoped product name
 * plus negative keywords.
 *
 * Any negative that appears in the product name itself is dropped —
 * otherwise the filter excludes the product by its own name. This is not
 * hypothetical: "Prismatic Evolutions Booster **Bundle**" and "Surging
 * Sparks Booster **Bundle**" both returned ZERO results against `-bundle`
 * (added to screen out multi-item lots), despite ~1400 and ~500 genuine
 * listings respectively. Same trap applies to "…**Case**",
 * "Pikachu **Coin**", "Player's **Guide**", and so on.
 */
export function buildSearchQuery(
  productName: string,
  negatives: ReadonlyArray<string> = DEFAULT_NEGATIVE_KEYWORDS,
): string {
  const base = ensurePokemonPrefix(
    normalizeProductName(productName.trim().replace(/\s+/g, " ")),
  );
  if (negatives.length === 0) return base;
  const applicable = negatives.filter(
    (n) => !new RegExp(`\\b${n}\\b`, "i").test(base),
  );
  if (applicable.length === 0) return base;
  return `${base} ${applicable.map((n) => `-${n}`).join(" ")}`;
}
