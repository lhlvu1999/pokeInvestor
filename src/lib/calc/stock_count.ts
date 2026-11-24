/**
 * Stock count: lay what is physically on the shelf against what the ledger
 * says you hold, and say exactly where they differ.
 *
 * Only units you have RECEIVED are counted. Units paid for but still in the
 * post are in the ledger as pending, not on a shelf, so they are neither
 * expected nor missing.
 *
 * A blank box means "not counted", never zero: an uncounted item is left
 * alone rather than being treated as missing. Zero has to be typed.
 */

export type CountRow = {
  itemId: string;
  name: string;
  /** Units the ledger says are in hand (received, not sold). */
  ledger: number;
  /** Cost basis per unit, minor units. */
  avgCost: number;
};

export type CountStatus =
  /** Nothing entered. */
  | "uncounted"
  /** Entered but not a whole number ≥ 0. */
  | "invalid"
  | "match"
  /** Fewer on the shelf than the ledger says. */
  | "short"
  /** More on the shelf than the ledger says. */
  | "over";

export type CountLine = CountRow & {
  status: CountStatus;
  /** The counted figure, when valid. */
  counted: number | null;
  /** counted − ledger (negative = missing), when valid. */
  diff: number | null;
  /** Cost basis of the missing units; 0 unless short. */
  missingCost: number;
};

/** Whole number ≥ 0 from what was typed, or null when blank/invalid. */
export function parseCount(raw: string | undefined): number | "invalid" | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return "invalid";
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : "invalid";
}

export function reconcile(
  rows: ReadonlyArray<CountRow>,
  entered: Readonly<Record<string, string>>,
): CountLine[] {
  return rows.map((r) => {
    const parsed = parseCount(entered[r.itemId]);
    if (parsed === null) {
      return {
        ...r,
        status: "uncounted",
        counted: null,
        diff: null,
        missingCost: 0,
      };
    }
    if (parsed === "invalid") {
      return {
        ...r,
        status: "invalid",
        counted: null,
        diff: null,
        missingCost: 0,
      };
    }
    const diff = parsed - r.ledger;
    return {
      ...r,
      status: diff === 0 ? "match" : diff < 0 ? "short" : "over",
      counted: parsed,
      diff,
      missingCost: diff < 0 ? -diff * r.avgCost : 0,
    };
  });
}

export type CountSummary = {
  counted: number;
  uncounted: number;
  invalid: number;
  matches: number;
  shortItems: number;
  /** Units the ledger has that the shelf doesn't. */
  missingUnits: number;
  missingCost: number;
  overItems: number;
  /** Units on the shelf that the ledger doesn't have. */
  extraUnits: number;
};

export function summarizeCount(lines: ReadonlyArray<CountLine>): CountSummary {
  const s: CountSummary = {
    counted: 0,
    uncounted: 0,
    invalid: 0,
    matches: 0,
    shortItems: 0,
    missingUnits: 0,
    missingCost: 0,
    overItems: 0,
    extraUnits: 0,
  };
  for (const l of lines) {
    if (l.status === "uncounted") s.uncounted += 1;
    else if (l.status === "invalid") s.invalid += 1;
    else {
      s.counted += 1;
      if (l.status === "match") s.matches += 1;
      if (l.status === "short") {
        s.shortItems += 1;
        s.missingUnits += -(l.diff ?? 0);
        s.missingCost += l.missingCost;
      }
      if (l.status === "over") {
        s.overItems += 1;
        s.extraUnits += l.diff ?? 0;
      }
    }
  }
  return s;
}

/**
 * Shortfalls a count would record, one per short item. `expectedHeld` is the
 * ledger figure the person counted against, so the server can refuse if the
 * ledger moved in the meantime.
 */
export type Shortfall = {
  itemId: string;
  missing: number;
  expectedHeld: number;
};

export function shortfallsOf(lines: ReadonlyArray<CountLine>): Shortfall[] {
  return lines
    .filter((l) => l.status === "short")
    .map((l) => ({
      itemId: l.itemId,
      missing: -(l.diff ?? 0),
      expectedHeld: l.ledger,
    }));
}
