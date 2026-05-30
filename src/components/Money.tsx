import { formatAmount, isSupportedCurrency } from "@/lib/currency";

type Props = {
  /** Amount in minor units of `currency`. */
  amount: number | null | undefined;
  currency: string | null | undefined;
  /** When true, color positive green, negative red, prefix +. */
  signed?: boolean;
  className?: string;
  fallback?: string;
};

export function Money({
  amount,
  currency,
  signed = false,
  className = "",
  fallback = "—",
}: Props) {
  if (amount == null || !currency || !isSupportedCurrency(currency)) {
    return <span className={className}>{fallback}</span>;
  }
  let color = "";
  if (signed) {
    if (amount > 0) color = "text-emerald-600 dark:text-emerald-400";
    else if (amount < 0) color = "text-rose-600 dark:text-rose-400";
  }
  const formatted = formatAmount(amount, currency);
  const display = signed && amount > 0 ? `+${formatted}` : formatted;
  return <span className={`${color} ${className}`.trim()}>{display}</span>;
}
