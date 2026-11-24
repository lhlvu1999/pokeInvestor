/** US cents -> "$1,234.56". TCGplayer prices are in US dollars. */
export function usdCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Big totals read better short: $1.2M, $34.5k, and exact below $10,000. */
export function usdCompact(cents: number): string {
  const d = cents / 100;
  const abs = Math.abs(d);
  if (abs >= 1_000_000)
    return `$${(d / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 10_000) return `$${(d / 1_000).toFixed(1)}k`;
  return usdCents(cents);
}
