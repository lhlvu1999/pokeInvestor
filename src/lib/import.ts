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
  uniqueItems: {
    matchKey: string;
    displayName: string;
    firstRowIndex: number;
  }[];
  totalBuys: number;
  totalSells: number;
};

/**
 * The columns we read, and the names a spreadsheet might give them. Only
 * Item, Date IN and IN are required: a file with no sale columns is just a
 * list of things you bought. "In stock" is not read at all (stock is worked
 * out from the buys and sells), so it never has to be present.
 */
export type ColumnField =
  "item" | "inStock" | "dateIn" | "amountIn" | "dateOut" | "amountOut";

export const COLUMN_SPECS: {
  field: ColumnField;
  /** The name used in the template and messages. */
  label: string;
  required: boolean;
  /** What it means, in plain words. */
  help: string;
  aliases: string[];
}[] = [
  {
    field: "item",
    label: "Item",
    required: true,
    help: "What you bought. Add ' x 12' at the end for a quantity of 12.",
    aliases: [
      "item",
      "item name",
      "name",
      "product",
      "product name",
      "description",
    ],
  },
  {
    field: "dateIn",
    label: "Date IN",
    required: true,
    help: "The day you bought it.",
    aliases: [
      "date in",
      "buy date",
      "date bought",
      "bought",
      "purchase date",
      "date of purchase",
    ],
  },
  {
    field: "amountIn",
    label: "IN",
    required: true,
    help: "What you paid, in total for the row.",
    aliases: [
      "in",
      "cost",
      "buy",
      "buy price",
      "paid",
      "price paid",
      "purchase price",
      "amount in",
    ],
  },
  {
    field: "dateOut",
    label: "Date Out",
    required: false,
    help: "The day you sold it. Leave empty if you still have it.",
    aliases: ["date out", "sell date", "date sold", "sold", "sale date"],
  },
  {
    field: "amountOut",
    label: "OUT",
    required: false,
    help: "What you sold it for, in total. 0 with a Date Out means written off.",
    aliases: [
      "out",
      "sell",
      "sell price",
      "sold for",
      "sale price",
      "received",
      "amount out",
    ],
  },
  {
    field: "inStock",
    label: "In stock",
    required: false,
    help: "Ignored. Stock is worked out from your buys and sells.",
    aliases: ["in stock", "stock", "instock", "remaining"],
  },
];

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");

export type HeaderMap =
  | {
      ok: true;
      /** Column index for each field that was found. */
      index: Partial<Record<ColumnField, number>>;
      /** Columns matched under a different name than ours. */
      renamed: { found: string; as: string }[];
      /** Columns in the file we don't use. */
      ignored: string[];
    }
  | { ok: false; message: string };

/**
 * Match the file's header row to our columns, forgivingly: any case, spaces
 * or underscores, and the common alternative names above. The first column
 * that matches a field wins.
 */
export function mapHeader(headerRow: string[]): HeaderMap {
  const cleaned = headerRow.map(norm);
  const index: Partial<Record<ColumnField, number>> = {};
  const renamed: { found: string; as: string }[] = [];
  const used = new Set<number>();

  for (const spec of COLUMN_SPECS) {
    const i = cleaned.findIndex(
      (h, at) => !used.has(at) && spec.aliases.includes(h),
    );
    if (i === -1) continue;
    index[spec.field] = i;
    used.add(i);
    if (cleaned[i] !== norm(spec.label))
      renamed.push({ found: headerRow[i].trim(), as: spec.label });
  }

  const missing = COLUMN_SPECS.filter(
    (s) => s.required && index[s.field] == null,
  );
  if (missing.length > 0) {
    const names = missing.map((m) => `"${m.label}"`).join(", ");
    const got = headerRow.map((h) => h.trim()).filter(Boolean);
    return {
      ok: false,
      message: `We couldn't find the ${names} column${missing.length === 1 ? "" : "s"}. Your file's columns are: ${got.length ? got.join(", ") : "(none)"}. Rename a column to match, or download the template to see the layout.`,
    };
  }

  return {
    ok: true,
    index,
    renamed,
    ignored: headerRow
      .map((h, i) => (used.has(i) ? null : h.trim()))
      .filter((h): h is string => !!h),
  };
}

/** Kept for callers that only want the error: null when the header is usable. */
export function checkHeaderRow(headerRow: string[]): string | null {
  const m = mapHeader(headerRow);
  return m.ok ? null : m.message;
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

export type DateOrder = "mdy" | "dmy";

/**
 * Parse a date into a UTC Date, or null if it isn't one.
 *
 * Accepts `2025-09-25` (unambiguous), and `9/25/2025`, `25/9/2025`,
 * `25-9-2025`, `25.9.2025` read in the given `order`. A two-digit year
 * means 20yy. Buys are stamped at 09:00 UTC, sells at 17:00 UTC, so a
 * same-day buy and sell replay buy-first.
 */
export function parseDate(
  input: string,
  hour: number,
  order: DateOrder = "mdy",
): Date | null {
  const t = input.trim();
  if (t === "") return null;
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    month = order === "mdy" ? a : b;
    day = order === "mdy" ? b : a;
    year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  }
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

/** The original US-order entry point, kept for existing callers. */
export function parseUsDate(input: string, hour: number): Date | null {
  return parseDate(input, hour, "mdy");
}

export type DateOrderGuess = {
  order: DateOrder;
  /**
   * True when the file itself settles it (some date has a first number over
   * 12, or a second number over 12). False when every date is readable both
   * ways, so day-first vs month-first is a guess the person should confirm.
   */
  certain: boolean;
};

/**
 * Work out whether a file writes dates day-first or month-first, from the
 * dates themselves. Only slash/dash/dot dates can be ambiguous; ISO dates
 * say nothing either way. When nothing settles it, month-first (the
 * original behaviour) is returned with `certain: false`.
 */
export function detectDateOrder(dates: ReadonlyArray<string>): DateOrderGuess {
  let firstOver12 = 0;
  let secondOver12 = 0;
  for (const raw of dates) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(raw.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver12 += 1;
    if (Number(m[2]) > 12) secondOver12 += 1;
  }
  if (firstOver12 > 0 && secondOver12 === 0)
    return { order: "dmy", certain: true };
  if (secondOver12 > 0 && firstOver12 === 0)
    return { order: "mdy", certain: true };
  return { order: "mdy", certain: false };
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
  /** How slash/dash dates are read. Defaults to month-first. */
  dateOrder?: DateOrder;
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
  const order = opts.dateOrder ?? "mdy";
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
    return {
      rowIndex,
      reason: "Item name is empty after parsing quantity",
      raw: row,
    };
  }

  const buyDate = parseDate(row.dateIn, 9, order);
  if (!buyDate) {
    return {
      rowIndex,
      reason: `Could not read the Date IN "${row.dateIn}" as a date`,
      raw: row,
    };
  }

  const buyAmount = parseAmount(row.amountIn);
  if (buyAmount == null || buyAmount < 0) {
    return {
      rowIndex,
      reason: `Could not read the IN amount "${row.amountIn}" as a number`,
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
  const sellDate = parseDate(row.dateOut, 17, order);
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

/**
 * A starter file people can fill in. It is itself a valid import (a test
 * runs it through the importer) and shows each case: a quantity in the name,
 * something sold, something still held, something written off.
 */
export const IMPORT_TEMPLATE_CSV = [
  "Item,Date IN,IN,Date Out,OUT",
  "Black Bolt Elite Trainer Box x 4,2025-11-07,8400000,2026-01-15,11200000",
  "Prismatic Evolutions Booster Bundle,2026-02-10,1600000,,",
  "Damaged Tin x 2,2026-03-02,900000,2026-04-01,0",
].join("\n");
