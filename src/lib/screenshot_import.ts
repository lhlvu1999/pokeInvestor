/**
 * Reading purchases and sales out of screenshots (an order history page, a
 * marketplace sales list) with a vision model.
 *
 * A model can misread a digit or invent a row, and money depends on these
 * numbers. So nothing here is trusted: the model's reply is parsed strictly,
 * anything that isn't a plain readable row is counted and dropped, and the
 * person must review and tick every remaining row before it can be saved.
 * This module is the pure half (prompt, limits, parsing, mapping to the
 * importer's rows); the model call itself is in `server/vision.ts`.
 */

import type { RawCsvRow } from "./import";

/** Most screenshots read in one go. */
export const MAX_IMAGES = 8;
/** Largest single image, after the browser has shrunk it. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
/** Rows read per request; more than this is almost certainly a mistake. */
export const MAX_ROWS = 300;

export const VISION_SYSTEM_PROMPT = `You read screenshots of a person's Pokémon trading-card purchases and sales and copy them into rows.

Reply with ONLY a JSON object: {"rows":[ ... ]}. Each row is one purchase, optionally with the sale of the same thing:
{"item": string, "quantity": integer, "dateIn": "YYYY-MM-DD", "amountIn": number, "dateOut": "YYYY-MM-DD" or null, "amountOut": number or null}

Rules:
- Copy only what is visible. Never guess, round or invent. If a row's item, purchase date or purchase amount is not clearly readable, leave that row out.
- "item" is the product name as written. Do not put the quantity in the name.
- "quantity" is the number of units for the row (1 if not shown).
- "amountIn" is the TOTAL paid for the row, "amountOut" the TOTAL received. Plain numbers only: no currency symbols, no thousands separators.
- Write every date as YYYY-MM-DD. If a date is ambiguous (for example 03/04/2025) and the page does not make the order clear, leave that row out.
- Use null for dateOut and amountOut when the item has not been sold.
- If the screenshots contain no purchase or sale rows, reply {"rows":[]}.`;

export type ExtractedRow = {
  item: string;
  quantity: number;
  dateIn: string;
  amountIn: number;
  dateOut: string | null;
  amountOut: number | null;
};

export type Extraction = {
  rows: ExtractedRow[];
  /** Rows in the reply that couldn't be used as given. */
  rejected: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d &&
    y >= 2000
  );
}

/** A finite number ≥ 0 from a number or a plain numeric string, else null. */
function amount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** The first JSON object or array in a reply, tolerating code fences. */
function jsonOf(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Turn the model's reply into rows we're willing to show. A row is kept only
 * if every field is exactly what the prompt asked for; anything else is
 * counted in `rejected` rather than repaired. A sale needs both a date and
 * an amount, and can't predate the purchase.
 */
export function parseExtraction(reply: string): Extraction {
  const parsed = jsonOf(reply);
  const list: unknown = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as { rows?: unknown }).rows
      : null;
  if (!Array.isArray(list)) return { rows: [], rejected: 0 };

  const rows: ExtractedRow[] = [];
  let rejected = 0;
  for (const r of list.slice(0, MAX_ROWS)) {
    if (!r || typeof r !== "object") {
      rejected += 1;
      continue;
    }
    const o = r as Record<string, unknown>;
    const item =
      typeof o.item === "string" ? o.item.replace(/\s+/g, " ").trim() : "";
    const qty =
      typeof o.quantity === "number" ? o.quantity : Number(o.quantity ?? 1);
    const dateIn = typeof o.dateIn === "string" ? o.dateIn.trim() : "";
    const amountIn = amount(o.amountIn);
    const dateOut =
      o.dateOut == null || o.dateOut === "" ? null : String(o.dateOut).trim();
    const amountOut =
      o.amountOut == null || o.amountOut === "" ? null : amount(o.amountOut);

    const saleHalf = dateOut != null || amountOut != null;
    const bad =
      item === "" ||
      item.length > 200 ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > 100_000 ||
      !realDate(dateIn) ||
      amountIn == null ||
      (saleHalf &&
        (dateOut == null ||
          amountOut == null ||
          !realDate(dateOut) ||
          dateOut < dateIn));
    if (bad) {
      rejected += 1;
      continue;
    }
    rows.push({
      item,
      quantity: qty,
      dateIn,
      amountIn: amountIn!,
      dateOut: saleHalf ? dateOut : null,
      amountOut: saleHalf ? amountOut : null,
    });
  }
  if (list.length > MAX_ROWS) rejected += list.length - MAX_ROWS;
  return { rows, rejected };
}

/** The importer's raw rows (ISO dates, so no date-order guesswork). */
export function toRawRows(rows: ReadonlyArray<ExtractedRow>): RawCsvRow[] {
  return rows.map((r) => ({
    item: r.quantity > 1 ? `${r.item} x ${r.quantity}` : r.item,
    inStock: "",
    dateIn: r.dateIn,
    amountIn: String(r.amountIn),
    dateOut: r.dateOut ?? "",
    amountOut: r.amountOut == null ? "" : String(r.amountOut),
  }));
}

export type ImageCheck = { ok: true } | { ok: false; error: string };

/** Size and type of a `data:` URL image, without trusting its label. */
export function inspectDataUrl(
  url: string,
): { mime: string; bytes: number } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(url);
  if (!m) return null;
  const b64 = m[2];
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return {
    mime: m[1].toLowerCase(),
    bytes: Math.floor((b64.length * 3) / 4) - pad,
  };
}

export function checkImages(urls: ReadonlyArray<string>): ImageCheck {
  if (urls.length === 0)
    return { ok: false, error: "Choose at least one screenshot." };
  if (urls.length > MAX_IMAGES)
    return {
      ok: false,
      error: `Choose at most ${MAX_IMAGES} screenshots at a time.`,
    };
  for (const [i, u] of urls.entries()) {
    const info = inspectDataUrl(u);
    if (!info)
      return {
        ok: false,
        error: `Screenshot ${i + 1} couldn't be read as an image.`,
      };
    if (!(ALLOWED_MIME as readonly string[]).includes(info.mime))
      return {
        ok: false,
        error: `Screenshot ${i + 1} is ${info.mime}; use a PNG, JPEG or WebP image.`,
      };
    if (info.bytes > MAX_IMAGE_BYTES)
      return {
        ok: false,
        error: `Screenshot ${i + 1} is too large (over ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`,
      };
  }
  return { ok: true };
}
