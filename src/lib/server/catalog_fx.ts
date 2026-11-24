/**
 * The US-dollar -> display-currency rate for the catalogue pages. A read (no
 * "use server"). Uses the app's existing FX cache: a fresh rate if it has one,
 * a stale cached one if the live fetch fails (and says so), and null when
 * there is no rate at all, in which case callers show dollars only.
 */

import type { Fx } from "@/lib/calc/catalog_money";
import { isSupportedCurrency, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";

/** Rate to convert US dollars into `currency`; null if none is available. */
export async function getUsdFx(currency: string): Promise<Fx | null> {
  if (currency === "USD" || !isSupportedCurrency(currency)) return null;
  try {
    const r = await getRate("USD", currency as CurrencyCode);
    return {
      currency,
      rate: r.rate,
      asOf: r.fetchedAt.toISOString(),
      stale: r.stale,
    };
  } catch {
    return null;
  }
}
