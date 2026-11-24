import { formatAmount } from "@/lib/currency";

/** Text colour class for a gain (green), loss (red) or nothing. */
export function tone(n: number): string {
  return n > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : n < 0
      ? "text-rose-600 dark:text-rose-400"
      : "";
}

/** "+₫1,000" / "−₫1,000" / "₫0". Uses a real minus sign. */
export function signed(n: number, currency: string): string {
  if (n === 0) return formatAmount(0, currency);
  return `${n > 0 ? "+" : "−"}${formatAmount(Math.abs(n), currency)}`;
}

/** Fraction → "+12.3%" / "−4.0%" / "0.0%". */
export function pct(f: number): string {
  return `${f > 0 ? "+" : f < 0 ? "−" : ""}${Math.abs(f * 100).toFixed(1)}%`;
}
