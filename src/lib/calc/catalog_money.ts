/**
 * Showing TCGplayer's US-dollar prices in the person's own currency.
 *
 * Catalogue prices are stored and fetched as US cents. Everywhere else the app
 * shows amounts in a display currency (VND by default), so the catalogue pages
 * convert too: the converted amount is the headline and the dollar figure
 * stays beside it, because the dollar price is what TCGplayer actually quotes.
 *
 * The rate is "display currency per 1 US dollar", the same convention as the
 * app's FX cache. With no usable rate the dollar price is shown on its own;
 * nothing is ever converted with a made-up rate.
 */

import {
  convertMinor,
  formatAmount,
  formatCompactAmount,
  getCurrencyMeta,
} from "@/lib/currency";
import { usdCents, usdCompact } from "@/lib/usd";

export type Fx = {
  /** The currency amounts are converted to. */
  currency: string;
  /** How many `currency` units one US dollar buys. */
  rate: number;
  /** When the rate was fetched (ISO). */
  asOf: string;
  /** True when it's an older cached rate because a refresh failed. */
  stale: boolean;
};

export type Shown = {
  /** What to show as the amount. */
  primary: string;
  /** The US-dollar figure to show beside it; null when it IS the primary. */
  secondary: string | null;
  /** Whether `primary` is a converted amount. */
  converted: boolean;
};

/** True if this rate can really be used to convert. */
export function usable(fx: Fx | null): fx is Fx {
  return (
    fx != null &&
    fx.currency !== "USD" &&
    Number.isFinite(fx.rate) &&
    fx.rate > 0
  );
}

/** US cents to minor units of the display currency, or null with no usable rate. */
export function convertUsdCents(cents: number, fx: Fx | null): number | null {
  return usable(fx) ? convertMinor(cents, "USD", fx.currency, fx.rate) : null;
}

/**
 * An amount for display: converted (headline) with the dollars alongside,
 * or just dollars when there's nothing to convert with. `compact` shortens
 * big numbers for tight spaces ("₫112M", "$2.5M").
 */
export function showUsd(cents: number, fx: Fx | null, compact = false): Shown {
  const usd = compact ? usdCompact(cents) : usdCents(cents);
  const minor = convertUsdCents(cents, fx);
  if (minor == null || !usable(fx)) {
    return { primary: usd, secondary: null, converted: false };
  }
  return {
    primary: compact
      ? formatCompactAmount(minor, fx.currency)
      : formatAmount(minor, fx.currency),
    secondary: usd,
    converted: true,
  };
}

/**
 * One line saying how prices were converted, for a footnote. `target` is the
 * currency the person asked to see: when it's US dollars there is nothing to
 * convert, which is different from having no rate to convert with.
 */
export function describeFx(fx: Fx | null, target?: string): string {
  if (target === "USD") {
    return "Prices are in US dollars, TCGplayer's currency (also your display currency).";
  }

  if (!usable(fx)) {
    return "Prices are in US dollars (TCGplayer's currency); no exchange rate is available to convert them.";
  }
  const day = new Date(fx.asOf).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  // The rate is "units of the currency per dollar", so scale it into that
  // currency's minor units before formatting (0.91 EUR is 91 cents).
  const exponent = getCurrencyMeta(fx.currency).exponent;
  const rate = formatAmount(Math.round(fx.rate * 10 ** exponent), fx.currency);
  return `Converted from US dollars at ${rate} per $1 (rate from ${day}${
    fx.stale ? ", an older rate because it couldn't be refreshed" : ""
  }).`;
}
