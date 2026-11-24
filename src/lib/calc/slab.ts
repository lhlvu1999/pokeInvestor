/**
 * Graded slabs against the same card ungraded.
 *
 * A slab's name carries who graded it and the grade ("slab psa 10 Charizard ex
 * 331/190 jp"). The pipeline matches it to a catalogue card and keeps that
 * card's raw (ungraded, near-mint) market price; here the two are compared.
 *
 * The premium is how much more a slab is valued than the raw card. It is a
 * description, not a grading verdict: it leaves out the cost of grading, and
 * the slab price is an estimate for one grade while the raw price is for the
 * card's best printing.
 */

const GRADERS = ["psa", "bgs", "cgc", "tag"] as const;
// "tag" is also an ordinary word ("Tag Team Collection"), so it only counts
// when a grade follows it; GRADE below covers that.
const SLAB_START = /^(slab|psa|bgs|cgc)\b/;
const GRADE = /\b(psa|bgs|cgc|tag)\s*(\d+(?:\.\d+)?)\b/;

/** True for a graded slab: by its name (as the pipeline reads it) or a "slab" tag. */
export function isSlabName(name: string, tags: readonly string[] = []): boolean {
  const n = name.toLowerCase().trim();
  return SLAB_START.test(n) || GRADE.test(n) || tags.includes("slab");
}

export type Grade = { grader: string; grade: string };

/** "PSA 10", from the name; null when it doesn't say. */
export function parseGrade(name: string): Grade | null {
  const m = GRADE.exec(name.toLowerCase());
  if (!m || !(GRADERS as readonly string[]).includes(m[1])) return null;
  return { grader: m[1].toUpperCase(), grade: m[2] };
}

export const gradeLabel = (g: Grade | null): string =>
  g ? `${g.grader} ${g.grade}` : "Graded";

export type Premium = {
  /** Slab value divided by raw value (2.0 = twice the raw card). */
  ratio: number;
  /** Slab value minus raw value, in the same unit as the inputs. */
  diff: number;
};

/** Both values per unit, in one currency; null unless both are known and positive. */
export function premium(
  slab: number | null | undefined,
  raw: number | null | undefined,
): Premium | null {
  if (slab == null || raw == null || !(slab > 0) || !(raw > 0)) return null;
  return { ratio: slab / raw, diff: slab - raw };
}

/** A slab valued below the raw card is odd enough to double-check. */
export const BELOW_RAW = 1;
/** So is one valued at ten times the raw card or more: often the wrong card or printing. */
export const WELL_ABOVE_RAW = 10;

export type SlabRow = {
  qty: number;
  /** Per unit, display currency; null when unknown. */
  slabEach: number | null;
  rawEach: number | null;
};

export type SlabSummary = {
  slabs: number;
  units: number;
  /** Slab value of the slabs that have a price (qty x price). */
  slabValue: number;
  /** Raw value of the matched cards of slabs that have a raw price. */
  rawValue: number;
  /** Slabs priced AND matched with a raw price: the ones the premium is about. */
  comparable: number;
  /** Their slab value and raw value, for the overall premium. */
  comparableSlab: number;
  comparableRaw: number;
  unpriced: number;
  unmatched: number;
};

export function summarizeSlabs(rows: readonly SlabRow[]): SlabSummary {
  const s: SlabSummary = {
    slabs: rows.length,
    units: 0,
    slabValue: 0,
    rawValue: 0,
    comparable: 0,
    comparableSlab: 0,
    comparableRaw: 0,
    unpriced: 0,
    unmatched: 0,
  };
  for (const r of rows) {
    s.units += r.qty;
    if (r.slabEach != null) s.slabValue += r.qty * r.slabEach;
    else s.unpriced += 1;
    if (r.rawEach != null) s.rawValue += r.qty * r.rawEach;
    else s.unmatched += 1;
    if (r.slabEach != null && r.rawEach != null) {
      s.comparable += 1;
      s.comparableSlab += r.qty * r.slabEach;
      s.comparableRaw += r.qty * r.rawEach;
    }
  }
  return s;
}

/** The overall premium over the slabs that can be compared, or null. */
export const overallPremium = (s: SlabSummary): Premium | null =>
  premium(s.comparableSlab, s.comparableRaw);

/** "2.4×", one decimal under 10, none above. */
export const ratioLabel = (r: number): string =>
  `${r >= 10 ? r.toFixed(0) : r.toFixed(1)}×`;

/**
 * A starting search for finding a slab's card by hand: the name with the grader,
 * grade, "slab" and "jp" taken out, so "slab psa 10 Eevee 173 jp" gives
 * "Eevee 173". The person can still edit it.
 */
export function slabSearchHint(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(psa|bgs|cgc|tag)\s*\d+(?:\.\d+)?\b/g, " ")
    .replace(/\b(slab|jp|jpn|japan|japanese)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words to search for: each must appear in the card's name or number. */
export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}/'&.-]/gu, ""))
    .filter((t) => t.length > 0)
    .slice(0, 6);
}

/** Make a word safe inside a LIKE pattern: %, _ and \ lose their special meaning. */
export const escapeLike = (t: string): string => t.replace(/[\\%_]/g, "\\$&");
