/**
 * Grading a vision model's reading of a screenshot against the known answer.
 *
 * Used by `scripts/check-vision.ts`, which sends synthetic screenshots to the
 * configured model. The standard is the one the prompt sets: copy only what is
 * clearly visible and never guess. So:
 *
 * - a row with a wrong value, a row that isn't on the page, and a row the
 *   prompt said to leave out (an ambiguous date, an unreadable amount) all
 *   FAIL the check;
 * - a readable row the model left out is reported as missing, which is
 *   incomplete but not unsafe, so it doesn't fail on its own.
 */

import type { ExtractedRow } from "./screenshot_import";

export type Expected = {
  note?: string;
  rows: ExtractedRow[];
  /** Fragments of item names the model must NOT return (rows to leave out). */
  mustOmit?: string[];
};

export type RowResult = {
  expected: ExtractedRow;
  status: "correct" | "wrong" | "missing";
  /** What differs, for a wrong row. */
  differences: string[];
  /** Notes that don't fail it (a shortened item name, say). */
  notes: string[];
  found: ExtractedRow | null;
};

export type CheckReport = {
  rows: RowResult[];
  correct: number;
  wrong: number;
  missing: number;
  /** Returned rows that aren't on the page. */
  invented: ExtractedRow[];
  /** Returned rows the prompt said to leave out. */
  forbidden: ExtractedRow[];
  /** Rows the app's own checks threw out of the model's reply. */
  rejected: number;
  /** No wrong, invented or forbidden rows. Missing rows don't fail it. */
  safe: boolean;
  /** Every readable row came back, too. */
  complete: boolean;
};

/** Lowercase, drop accents and punctuation, collapse spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const sameAmount = (a: number | null, b: number | null) =>
  a === b || (a != null && b != null && Math.abs(a - b) < 0.005);

function differences(e: ExtractedRow, f: ExtractedRow): string[] {
  const out: string[] = [];
  if (f.quantity !== e.quantity)
    out.push(`quantity ${f.quantity}, expected ${e.quantity}`);
  if (f.dateIn !== e.dateIn)
    out.push(`bought ${f.dateIn}, expected ${e.dateIn}`);
  if (!sameAmount(f.amountIn, e.amountIn))
    out.push(`paid ${f.amountIn}, expected ${e.amountIn}`);
  if (f.dateOut !== e.dateOut)
    out.push(`sold ${f.dateOut ?? "never"}, expected ${e.dateOut ?? "never"}`);
  if (!sameAmount(f.amountOut, e.amountOut))
    out.push(
      `received ${f.amountOut ?? "nothing"}, expected ${e.amountOut ?? "nothing"}`,
    );
  return out;
}

/** The same product: equal names, or one is the other with extra words. */
function sameProduct(a: string, b: string): "exact" | "partial" | null {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x === y) return "exact";
  if (x && y && (x.includes(y) || y.includes(x))) return "partial";
  return null;
}

export function compareExtraction(
  expected: Expected,
  actual: ReadonlyArray<ExtractedRow>,
  rejected = 0,
): CheckReport {
  const unused = new Set(actual.map((_, i) => i));
  const omit = (expected.mustOmit ?? []).map(normalizeName);
  const results: RowResult[] = [];

  for (const e of expected.rows) {
    // Prefer an exact name with the same purchase date, then any exact name,
    // then a shortened one.
    const candidates = [...unused]
      .map((i) => ({ i, row: actual[i], kind: sameProduct(actual[i].item, e.item) }))
      .filter((c) => c.kind != null);
    const pick =
      candidates.find((c) => c.kind === "exact" && c.row.dateIn === e.dateIn) ??
      candidates.find((c) => c.kind === "exact") ??
      candidates.find((c) => c.kind === "partial" && c.row.dateIn === e.dateIn) ??
      candidates[0];
    if (!pick) {
      results.push({
        expected: e,
        status: "missing",
        differences: [],
        notes: [],
        found: null,
      });
      continue;
    }
    unused.delete(pick.i);
    const diffs = differences(e, pick.row);
    results.push({
      expected: e,
      status: diffs.length === 0 ? "correct" : "wrong",
      differences: diffs,
      notes:
        pick.kind === "partial"
          ? [`item written "${pick.row.item}", page says "${e.item}"`]
          : [],
      found: pick.row,
    });
  }

  const forbidden: ExtractedRow[] = [];
  const invented: ExtractedRow[] = [];
  for (const i of unused) {
    const row = actual[i];
    const n = normalizeName(row.item);
    (omit.some((o) => o && n.includes(o)) ? forbidden : invented).push(row);
  }

  const count = (s: RowResult["status"]) =>
    results.filter((r) => r.status === s).length;
  const wrong = count("wrong");
  const missing = count("missing");
  return {
    rows: results,
    correct: count("correct"),
    wrong,
    missing,
    invented,
    forbidden,
    rejected,
    safe: wrong === 0 && invented.length === 0 && forbidden.length === 0,
    complete: missing === 0,
  };
}
