/**
 * Pure functions to translate a Pokemon-business style CSV row into our
 * internal model (items + buy/sell transactions).
 *
 * Source columns: Item, In stock, Date IN, IN, Date Out, OUT, % profit, Profit
 * Currency is assumed VND for the whole import (selectable in the UI).
 */

export type RawCsvRow = {
  item: string;
  inStock: string;
  dateIn: string;
  amountIn: string;
  dateOut: string;
  amountOut: string;
  // % profit and Profit columns are ignored — we recompute from buys/sells
};

export type ParsedTransaction = {
  type: "buy" | "sell";
  quantity: number;
  amountMinor: number; // already in minor units of the chosen currency
  occurredAt: Date;
};

export type ParsedRow = {
  rowIndex: number; // 1-based, matching CSV line minus header
  itemDisplayName: string;
  itemMatchKey: string; // case-insensitive normalized name for dedup
  quantity: number;
  transactions: ParsedTransaction[];
};

export type RowError = {
  rowIndex: number;
  reason: string;
  raw: RawCsvRow;
};

export type ImportPreview = {
  rows: ParsedRow[];
  errors: RowError[];
  uniqueItems: { matchKey: string; displayName: string; firstRowIndex: number }[];
  totalBuys: number;
  totalSells: number;
};

const HEADERS_EXPECTED = [
  "Item",
  "In stock",
  "Date IN",
  "IN",
  "Date Out",
  "OUT",
];

export function checkHeaderRow(headerRow: string[]): string | null {
  const lower = headerRow.map((h) => h.trim().toLowerCase());
  for (const expected of HEADERS_EXPECTED) {
    if (!lower.includes(expected.toLowerCase())) {
      return `Missing required column "${expected}". Got: ${headerRow.join(", ")}`;
    }
  }
  return null;
}

/**
 * Strip a trailing ` x N` quantity suffix from an item name.
 * Returns { name, quantity }. quantity defaults to 1.
 *
 * Examples:
 *  "box sv4a x 60"   → { name: "box sv4a", quantity: 60 }
 *  "etb black"       → { name: "etb black", quantity: 1 }
 *  "promo mimikyu x 8 " (trailing space) → { name: "promo mimikyu", quantity: 8 }
 *  "case prismatic (12) poster x 8" → { name: "case prismatic (12) poster", quantity: 8 }
 *
 * Note: parenthetical descriptors like "(3slabs)" or "(1pack)" are kept in
 * the name — they're descriptive, not multipliers, and treating them as
 * quantity creates false matches across products.
 */
export function extractQuantity(rawName: string): {
  name: string;
  quantity: number;
} {
  const trimmed = rawName.trim();
  const match = /^(.*?)\s+x\s+(\d+)$/i.exec(trimmed);
  if (!match) return { name: collapseSpaces(trimmed), quantity: 1 };
  const qty = Number(match[2]);
  if (!Number.isInteger(qty) || qty <= 0) {
    return { name: collapseSpaces(trimmed), quantity: 1 };
  }
  return { name: collapseSpaces(match[1].trim()), quantity: qty };
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Case-insensitive normalized key used to dedup items across rows.
 * Two rows with names "etb black" and "etb Black" → same key.
 */
export function itemMatchKey(name: string): string {
  return name.toLowerCase().normalize("NFKC");
}

/**
 * Parse a US-style date "M/D/YYYY" into a Date. Returns null on failure.
 * Buys are stamped at 09:00 UTC, sells at 17:00 UTC, so same-day buy + sell
 * sort buy-first in chronological replay.
 */
export function parseUsDate(
  input: string,
  hour: number,
): Date | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

function parseAmount(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}

export type TransformOptions = {
  /**
   * Multiplied into every parsed IN/OUT value before it becomes a transaction
   * amount. Useful when the CSV stores values in thousands (multiplier=1000)
   * or millions. Defaults to 1.
   */
  valueMultiplier?: number;
};

/**
 * Translate one CSV row into 0/1/2 transactions and an item descriptor.
 * Returns null on a row that should be skipped silently (blank).
 * Returns a RowError when the row is malformed.
 */
export function transformRow(
  row: RawCsvRow,
  rowIndex: number,
  opts: TransformOptions = {},
): ParsedRow | RowError | null {
  const multiplier = opts.valueMultiplier ?? 1;
  if (
    row.item.trim() === "" &&
    row.dateIn.trim() === "" &&
    row.amountIn.trim() === ""
  ) {
    return null;
  }
  if (row.item.trim() === "") {
    return { rowIndex, reason: "Item name is empty", raw: row };
  }

  const { name, quantity } = extractQuantity(row.item);
  if (name === "") {
    return { rowIndex, reason: "Item name is empty after parsing quantity", raw: row };
  }

  const buyDate = parseUsDate(row.dateIn, 9);
  if (!buyDate) {
    return {
      rowIndex,
      reason: `Could not parse Date IN: "${row.dateIn}"`,
      raw: row,
    };
  }

  const buyAmount = parseAmount(row.amountIn);
  if (buyAmount == null || buyAmount < 0) {
    return {
      rowIndex,
      reason: `Could not parse IN value: "${row.amountIn}"`,
      raw: row,
    };
  }

  const transactions: ParsedTransaction[] = [
    {
      type: "buy",
      quantity,
      amountMinor: Math.round(buyAmount * multiplier),
      occurredAt: buyDate,
    },
  ];

  // Date Out is authoritative for whether a sell happened. OUT=0 with a
  // Date Out is a real sell at zero (write-off / loss). Only when Date Out
  // is empty do we treat the row as "still held".
  const sellDate = parseUsDate(row.dateOut, 17);
  if (sellDate) {
    const sellAmount = parseAmount(row.amountOut);
    if (sellAmount == null || sellAmount < 0) {
      return {
        rowIndex,
        reason: `Date Out is set but OUT is missing or invalid: "${row.amountOut}"`,
        raw: row,
      };
    }
    if (sellDate.getTime() < buyDate.getTime()) {
      return {
        rowIndex,
        reason: `Date Out (${row.dateOut}) is before Date IN (${row.dateIn})`,
        raw: row,
      };
    }
    transactions.push({
      type: "sell",
      quantity,
      amountMinor: Math.round(sellAmount * multiplier),
      occurredAt: sellDate,
    });
  }

  return {
    rowIndex,
    itemDisplayName: name,
    itemMatchKey: itemMatchKey(name),
    quantity,
    transactions,
  };
}

export function buildPreview(
  rows: RawCsvRow[],
  opts: TransformOptions = {},
): ImportPreview {
  const parsed: ParsedRow[] = [];
  const errors: RowError[] = [];
  const itemFirstSeen = new Map<
    string,
    { matchKey: string; displayName: string; firstRowIndex: number }
  >();
  let totalBuys = 0;
  let totalSells = 0;

  rows.forEach((raw, idx) => {
    const rowIndex = idx + 1;
    const result = transformRow(raw, rowIndex, opts);
    if (result == null) return;
    if ("reason" in result) {
      errors.push(result);
      return;
    }
    parsed.push(result);
    if (!itemFirstSeen.has(result.itemMatchKey)) {
      itemFirstSeen.set(result.itemMatchKey, {
        matchKey: result.itemMatchKey,
        displayName: result.itemDisplayName,
        firstRowIndex: rowIndex,
      });
    }
    for (const tx of result.transactions) {
      if (tx.type === "buy") totalBuys += 1;
      else totalSells += 1;
    }
  });

  return {
    rows: parsed,
    errors,
    uniqueItems: Array.from(itemFirstSeen.values()),
    totalBuys,
    totalSells,
  };
}
