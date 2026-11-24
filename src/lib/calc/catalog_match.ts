/**
 * Suggest which catalogue product an item is.
 *
 * A wrong link is worse than none: a booster box matched to its CASE is a
 * tenfold price error. So this only ever SUGGESTS, and says how sure it is:
 *
 * - `confident`: one clearly best product, safe to pre-tick.
 * - `ambiguous`: two or more products score the same (a tin with several
 *   Pokémon, a bundle sold in a retail and a game-store version). The person
 *   has to choose.
 * - `probable` / `weak`: a similar product exists but something differs
 *   (an extra word, a different set). Shown, never pre-ticked.
 * - `none`: nothing close.
 * - `not_sealed`: graded slabs and single cards or promos aren't sealed
 *   products, so there is nothing to match.
 *
 * Scoring compares the words of the item with the words of the product name,
 * with the set name counted as context. A product-type word the item never
 * wrote ("display", "case", "bundle"...) is penalised, because that is exactly
 * how a single tin gets confused with a box of ten.
 */

export type CatalogCandidate = {
  productId: number;
  name: string;
  setName: string;
  language: "en" | "ja";
  imageUrl: string | null;
  /** Latest market price in US cents, if the product has one. */
  marketCents: number | null;
};

export type MatchStatus =
  "confident" | "ambiguous" | "probable" | "weak" | "none" | "not_sealed";

export type Scored = { candidate: CatalogCandidate; score: number };

export type MatchResult = {
  status: MatchStatus;
  /** Best first; at most `limit`. Empty for `not_sealed`. */
  options: Scored[];
};

/** Words that never help tell products apart. */
const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "pokemon",
  "tcg",
  "x",
  "jp",
]);

/** Product-type words: a product carrying one the item lacks is a different thing. */
const TYPE_WORDS = new Set([
  "display",
  "case",
  "half",
  "sleeved",
  "pack",
  "blister",
  "bundle",
  "tin",
  "box",
  "collection",
  "deck",
  "binder",
  "figure",
  "poster",
  "booster",
]);

export const CONFIDENT_SCORE = 0.85;
export const PROBABLE_SCORE = 0.7;
export const WEAK_SCORE = 0.5;
/** Best and runner-up closer than this count as a tie. */
export const TIE_MARGIN = 0.03;

export function tokens(name: string): string[] {
  let s = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/&/g, " and ");
  // Spellings people use for the same thing.
  s = s.replace(/\betb\b/g, "elite trainer box");
  s = s.replace(/(\d)\s*blister\b/g, "$1 pack blister");
  // "36 packs" describes a box, not a different product; but "2 pack blister"
  // is the product's own name, so it stays.
  s = s.replace(/\b\d+\s*packs?\b(?!\s*blister)/g, " ");
  s = s.replace(/[^a-z0-9]+/g, " ");
  return s.split(" ").filter((w) => w !== "" && !STOP.has(w));
}

/** Slabs and single cards or promos have no sealed product to match. */
export function isSealedCandidate(item: {
  name: string;
  tags: string[];
}): boolean {
  const n = item.name.toLowerCase();
  // "tag" is also an ordinary word ("Tag Team Collection"), so it only marks a
  // slab when a grade follows it ("tag 10 ...").
  if (/^((slab|psa|bgs|cgc)\b|tag\s*\d)/.test(n)) return false;
  if (/\b(psa|bgs|cgc)\s*\d/.test(n)) return false;
  if (item.tags.includes("slab")) return false;
  if (n.startsWith("promo")) return false;
  return true;
}

function setOf(words: string[]): Set<string> {
  return new Set(words);
}

/** 0..1: how well `item` describes `candidate`. */
export function scoreMatch(
  itemWords: ReadonlySet<string>,
  c: { nameWords: ReadonlySet<string>; setWords: ReadonlySet<string> },
): number {
  if (itemWords.size === 0) return 0;
  let inName = 0;
  let inContext = 0;
  for (const w of itemWords) {
    if (c.nameWords.has(w)) inName += 1;
    if (c.nameWords.has(w) || c.setWords.has(w)) inContext += 1;
  }
  const cover = inContext / itemWords.size;
  const union = new Set([...itemWords, ...c.nameWords]).size;
  const jaccard = inName / union;
  let extraTypes = 0;
  for (const w of c.nameWords) {
    if (TYPE_WORDS.has(w) && !itemWords.has(w)) extraTypes += 1;
  }
  return Math.max(0, 0.6 * cover + 0.4 * jaccard - 0.2 * extraTypes);
}

export type PreparedCatalog = {
  candidate: CatalogCandidate;
  nameWords: Set<string>;
  setWords: Set<string>;
}[];

/** Tokenise the catalogue once, then match many items against it. */
export function prepareCatalog(
  candidates: ReadonlyArray<CatalogCandidate>,
): PreparedCatalog {
  return candidates.map((candidate) => ({
    candidate,
    nameWords: setOf(tokens(candidate.name)),
    setWords: setOf(tokens(candidate.setName)),
  }));
}

export function matchItem(
  item: { name: string; tags: string[] },
  catalog: PreparedCatalog,
  limit = 3,
): MatchResult {
  if (!isSealedCandidate(item)) return { status: "not_sealed", options: [] };
  const words = setOf(tokens(item.name));
  const scored: Scored[] = [];
  for (const p of catalog) {
    const score = scoreMatch(words, p);
    if (score > 0) scored.push({ candidate: p.candidate, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || a.candidate.productId - b.candidate.productId,
  );
  const options = scored.slice(0, limit);
  const best = options[0];
  if (!best || best.score < WEAK_SCORE) return { status: "none", options };

  if (best.score >= CONFIDENT_SCORE) {
    const tied = options.filter((o) => best.score - o.score < TIE_MARGIN);
    return { status: tied.length > 1 ? "ambiguous" : "confident", options };
  }
  return {
    status: best.score >= PROBABLE_SCORE ? "probable" : "weak",
    options,
  };
}

/**
 * Does the catalogue price look like the same product as the item's price?
 * Only a sanity check on a suggestion: a case priced like a box means the
 * wrong product. Prices are compared in one currency (USD).
 */
export function priceSanity(
  itemUsd: number | null,
  catalogUsd: number | null,
): "ok" | "differs" | "unknown" {
  if (!itemUsd || !catalogUsd || itemUsd <= 0 || catalogUsd <= 0)
    return "unknown";
  const ratio = itemUsd / catalogUsd;
  return ratio >= 0.5 && ratio <= 2 ? "ok" : "differs";
}
