/**
 * Annualized return for one position, from a choice of starting point.
 *
 * - "purchase": your own money. A money-weighted return (XIRR) over your buys
 *   and sales of this item, with what you still hold counted at today's value.
 *   This is what you actually earned.
 * - "launch", "6m", "1y": the product's market price, from where it started
 *   to now (a compound rate between two prices). This isn't what you earned;
 *   it is what the product itself did from that starting point, which is the
 *   fair yardstick for whether your entry price helped or hurt.
 *
 * Every basis is held back until there are 90 days behind it, and a rate from
 * under a year is flagged as a projection.
 */

import {
  computeReturn,
  FULL_YEAR_DAYS,
  MIN_DAYS,
  type ReturnReport,
} from "./annualized";
import { daysBetween } from "./set_history";

export type Basis = "purchase" | "launch" | "6m" | "1y";

export const BASES: ReadonlyArray<Basis> = ["purchase", "launch", "6m", "1y"];

export const BASIS_LABELS: Record<Basis, string> = {
  purchase: "My purchases",
  launch: "Launch price",
  "6m": "6 months ago",
  "1y": "1 year ago",
};

/** Days back from "now" for the period bases. */
export const PERIOD_DAYS: Record<"6m" | "1y", number> = {
  "6m": 182,
  "1y": 365,
};

export type UnavailableReason =
  | "not_held"
  | "not_linked"
  | "no_release_date"
  | "no_entry_price"
  | "no_current_price"
  | "no_activity"
  | "ambiguous"
  | "no_fit";

export type ReturnResult =
  | {
      status: "ok";
      basis: Basis;
      /** Yearly rate as a fraction (0.34 = +34% a year). */
      annualized: number;
      /** Total change over the whole span (0.2 = +20%). */
      change: number;
      days: number;
      /** YYYY-MM-DD the span starts. */
      entryDay: string;
      /** True when under a year, so the rate is a projection. */
      extrapolated: boolean;
      /** The two prices the rate comes from (market bases only), US cents. */
      prices?: { entry: PricePoint; now: PricePoint };
    }
  | {
      status: "too_early";
      basis: Basis;
      days: number;
      daysToGo: number;
      entryDay: string;
    }
  | { status: "unavailable"; basis: Basis; reason: UnavailableReason };

export type PricePoint = { day: string; cents: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Compound rate between two prices. The span must be at least 90 days; an
 * entry or current price of zero (or less) has no rate.
 */
export function priceReturn(
  basis: Basis,
  entry: PricePoint | null,
  now: PricePoint | null,
): ReturnResult {
  if (!entry) return { status: "unavailable", basis, reason: "no_entry_price" };
  if (!now) return { status: "unavailable", basis, reason: "no_current_price" };
  if (!(entry.cents > 0) || !(now.cents > 0)) {
    return { status: "unavailable", basis, reason: "no_entry_price" };
  }
  const days = daysBetween(entry.day, now.day);
  if (days < MIN_DAYS) {
    return {
      status: "too_early",
      basis,
      days: Math.max(0, days),
      daysToGo: MIN_DAYS - Math.max(0, days),
      entryDay: entry.day,
    };
  }
  const change = now.cents / entry.cents - 1;
  return {
    status: "ok",
    basis,
    annualized: Math.pow(now.cents / entry.cents, 365 / days) - 1,
    change,
    days,
    entryDay: entry.day,
    extrapolated: days < FULL_YEAR_DAYS,
    prices: { entry, now },
  };
}

/** Express the whole-money report as a per-position result. */
export function fromReport(report: ReturnReport): ReturnResult {
  switch (report.status) {
    case "none":
      return { status: "unavailable", basis: "purchase", reason: "no_activity" };
    case "too_early":
      return {
        status: "too_early",
        basis: "purchase",
        days: report.days,
        daysToGo: report.daysToGo,
        entryDay: iso(report.firstAt),
      };
    case "unavailable":
      return {
        status: "unavailable",
        basis: "purchase",
        reason: report.reason === "ambiguous" ? "ambiguous" : "no_fit",
      };
    case "ok":
      return {
        status: "ok",
        basis: "purchase",
        annualized: report.annualized,
        change: report.multiple - 1,
        days: report.days,
        entryDay: iso(report.firstAt),
        extrapolated: report.extrapolated,
      };
  }
}

/** One item's purchase-basis result from its own buys and sales. */
export function purchaseReturn(
  events: Parameters<typeof computeReturn>[0],
  terminalValue: number,
  now: Date,
): ReturnResult {
  return fromReport(computeReturn(events, terminalValue, now));
}

/** The date a period basis starts on, counted back from the current price day. */
export function periodEntryDay(basis: "6m" | "1y", nowDay: string): string {
  const t = Date.UTC(+nowDay.slice(0, 4), +nowDay.slice(5, 7) - 1, +nowDay.slice(8, 10));
  return iso(new Date(t - PERIOD_DAYS[basis] * 86_400_000));
}

export const UNAVAILABLE_TEXT: Record<UnavailableReason, string> = {
  not_held: "You don't hold this any more.",
  not_linked: "Not linked to the catalogue, so there's no price history to measure from.",
  no_release_date: "No reliable release date for its set.",
  no_entry_price: "The catalogue has no price for that starting point.",
  no_current_price: "No recent catalogue price.",
  no_activity: "No buys or sales yet.",
  ambiguous:
    "Your money moved in and out in a pattern that fits more than one yearly rate, so any single number would be a guess.",
  no_fit: "No yearly rate fits these flows.",
};

/** The basis named in a URL parameter; anything unrecognised is "purchase". */
export function parseBasis(raw: string | string[] | undefined): Basis {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (BASES as ReadonlyArray<string>).includes(v ?? "")
    ? (v as Basis)
    : "purchase";
}

/** "52 days", "5 months", "1.5 years": how long a span is, in plain words. */
export function durationLabel(days: number): string {
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

/** The yearly rate as text; a rate this large is arithmetic, not a forecast. */
export const RATE_CAP = 10;
export function rateText(annualized: number): string {
  if (annualized > RATE_CAP) return "more than +1,000%";
  const pct = annualized * 100;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%`;
}
