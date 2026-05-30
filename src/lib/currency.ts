/**
 * ISO 4217 currency support. Money is stored as integer minor units of the
 * row's currency (e.g. cents for USD, dong for VND).
 *
 *   exponent 2 → "12.34" entered, stored as 1234
 *   exponent 0 → "1850"  entered, stored as 1850
 */

export type CurrencyCode =
  | "VND"
  | "USD"
  | "EUR"
  | "JPY"
  | "GBP"
  | "KRW"
  | "TWD"
  | "HKD"
  | "CNY"
  | "THB"
  | "SGD"
  | "AUD"
  | "CAD";

export type CurrencyMeta = {
  code: CurrencyCode;
  name: string;
  exponent: number;
  symbol: string;
};

export const SUPPORTED_CURRENCIES: CurrencyMeta[] = [
  { code: "VND", name: "Vietnamese Dong", exponent: 0, symbol: "₫" },
  { code: "USD", name: "US Dollar", exponent: 2, symbol: "$" },
  { code: "EUR", name: "Euro", exponent: 2, symbol: "€" },
  { code: "JPY", name: "Japanese Yen", exponent: 0, symbol: "¥" },
  { code: "GBP", name: "British Pound", exponent: 2, symbol: "£" },
  { code: "KRW", name: "Korean Won", exponent: 0, symbol: "₩" },
  { code: "TWD", name: "Taiwan Dollar", exponent: 2, symbol: "NT$" },
  { code: "HKD", name: "Hong Kong Dollar", exponent: 2, symbol: "HK$" },
  { code: "CNY", name: "Chinese Yuan", exponent: 2, symbol: "¥" },
  { code: "THB", name: "Thai Baht", exponent: 2, symbol: "฿" },
  { code: "SGD", name: "Singapore Dollar", exponent: 2, symbol: "S$" },
  { code: "AUD", name: "Australian Dollar", exponent: 2, symbol: "A$" },
  { code: "CAD", name: "Canadian Dollar", exponent: 2, symbol: "C$" },
];

const META_BY_CODE = new Map<CurrencyCode, CurrencyMeta>(
  SUPPORTED_CURRENCIES.map((c) => [c.code, c]),
);

export const DEFAULT_TRANSACTION_CURRENCY: CurrencyCode = "VND";
export const DEFAULT_DISPLAY_CURRENCY: CurrencyCode = "VND";

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return META_BY_CODE.has(code as CurrencyCode);
}

export function getCurrencyMeta(code: string): CurrencyMeta {
  const meta = META_BY_CODE.get(code as CurrencyCode);
  if (!meta) throw new Error(`Unsupported currency: ${code}`);
  return meta;
}

/**
 * Parse a user-entered amount string into integer minor units of `currency`.
 *  parseAmount("18.50", "USD") → 1850
 *  parseAmount("1850",  "VND") → 1850
 *  parseAmount("1,850.50", "USD") → 185050   // commas tolerated
 */
export function parseAmount(input: string | number, currency: string): number {
  const meta = getCurrencyMeta(currency);
  const raw = (typeof input === "number" ? input.toString() : input)
    .trim()
    .replace(/,/g, "");
  if (raw === "") throw new Error("Empty amount");

  const fractionRe =
    meta.exponent === 0
      ? /^-?\d+$/
      : new RegExp(`^-?\\d+(\\.\\d{1,${meta.exponent}})?$`);
  if (!fractionRe.test(raw)) {
    throw new Error(
      `Invalid ${currency} amount: ${input}` +
        (meta.exponent === 0
          ? " (no decimals allowed)"
          : ` (max ${meta.exponent} decimal places)`),
    );
  }

  const sign = raw.startsWith("-") ? -1 : 1;
  const abs = raw.replace("-", "");
  const [whole, fractionPart = ""] = abs.split(".");
  if (meta.exponent === 0) {
    const minor = sign * Number(whole);
    if (!Number.isSafeInteger(minor)) throw new Error("Amount out of range");
    return minor;
  }
  const fraction = fractionPart.padEnd(meta.exponent, "0");
  const factor = 10 ** meta.exponent;
  const minor = sign * (Number(whole) * factor + Number(fraction));
  if (!Number.isSafeInteger(minor)) throw new Error("Amount out of range");
  return minor;
}

export function minorToDecimalString(minor: number, currency: string): string {
  const meta = getCurrencyMeta(currency);
  if (meta.exponent === 0) return Math.trunc(minor).toString();
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const factor = 10 ** meta.exponent;
  const whole = Math.floor(abs / factor);
  const fraction = (abs % factor).toString().padStart(meta.exponent, "0");
  return `${sign}${whole}.${fraction}`;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(code: string): Intl.NumberFormat {
  let f = formatterCache.get(code);
  if (!f) {
    const meta = getCurrencyMeta(code);
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: meta.exponent,
      maximumFractionDigits: meta.exponent,
    });
    formatterCache.set(code, f);
  }
  return f;
}

const compactFormatterCache = new Map<string, Intl.NumberFormat>();

function getCompactFormatter(code: string): Intl.NumberFormat {
  let f = compactFormatterCache.get(code);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: 1,
    });
    compactFormatterCache.set(code, f);
  }
  return f;
}

/**
 * Format a minor-unit amount as a localized currency string.
 *  formatAmount(1850, "USD") → "$18.50"
 *  formatAmount(1850, "VND") → "₫1,850"
 */
export function formatAmount(minor: number, currency: string): string {
  const meta = getCurrencyMeta(currency);
  const major = meta.exponent === 0 ? minor : minor / 10 ** meta.exponent;
  return getFormatter(currency).format(major);
}

/**
 * Compact currency format for tight UI spaces (chart axis labels, etc).
 *   formatCompactAmount(2_940_000, "VND") → "₫2.9M"
 *   formatCompactAmount(109_410_000, "VND") → "₫109M"
 *   formatCompactAmount(1_850, "USD") → "$18.50"  (small values stay verbose)
 */
export function formatCompactAmount(minor: number, currency: string): string {
  const meta = getCurrencyMeta(currency);
  const major = meta.exponent === 0 ? minor : minor / 10 ** meta.exponent;
  return getCompactFormatter(currency).format(major);
}

/**
 * Convert a minor-unit amount from one currency to another, using the given
 * "quote per 1 base" rate. Rounds to the nearest target minor unit.
 */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  rate: number,
): number {
  if (from === to) return amountMinor;
  const fromMeta = getCurrencyMeta(from);
  const toMeta = getCurrencyMeta(to);
  const fromMajor = amountMinor / 10 ** fromMeta.exponent;
  const toMajor = fromMajor * rate;
  return Math.round(toMajor * 10 ** toMeta.exponent);
}
