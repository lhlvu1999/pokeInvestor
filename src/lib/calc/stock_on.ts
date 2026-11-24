/**
 * What you held on a given day, and how a year's stock moved.
 *
 * Stock on a day is worked out by replaying only the transactions up to the end
 * of that day (UTC), with your chosen cost method, so it is the same replay the
 * rest of the app uses. Cost is the exact cost of the units still held. Value is
 * units times the latest market price recorded on or before that day.
 *
 * A year then reconciles: opening stock + what you bought - the cost of what
 * left (sold, gifted, lost or opened) = closing stock, at cost. The reconciling
 * line is what makes the numbers checkable against a ledger.
 *
 * Units bought but not yet received are not stock yet, so they are not counted.
 */

import type { Transaction } from "@/db/schema";
import { replayForAnalytics } from "./analytics";
import type { CostMethod } from "./holdings";

export type StockTx = Pick<
  Transaction,
  | "id"
  | "type"
  | "quantity"
  | "finalValueCents"
  | "occurredAt"
  | "currency"
  | "lotId"
  | "status"
> & { exitReason?: string | null };

export type StockPrice = { priceCents: number; fetchedAt: Date };

/** A price older than this on the day it is used is flagged as stale. */
export const STALE_PRICE_DAYS = 30;

const DAY = 86_400_000;

/** The last instant of a UTC calendar day, from "YYYY-MM-DD". */
export function endOfDay(day: string): Date {
  return new Date(`${day}T23:59:59.999Z`);
}

export const isDay = (v: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

export const yearEnd = (year: number): Date => endOfDay(`${year}-12-31`);

export type Held = { qty: number; cost: number };

/** Units still held after replaying everything up to and including `asOf`. */
export function heldOn(
  txs: readonly StockTx[],
  asOf: Date,
  method: CostMethod,
): Held {
  const upTo = txs.filter((t) => t.occurredAt.getTime() <= asOf.getTime());
  if (upTo.length === 0) return { qty: 0, cost: 0 };
  const { remaining } = replayForAnalytics(upTo, method);
  return {
    qty: remaining.reduce((n, e) => n + e.qty, 0),
    cost: remaining.reduce((n, e) => n + e.cost, 0),
  };
}

/** Latest price on or before `asOf`, from prices sorted oldest first. */
export function priceOnOrBefore(
  sorted: readonly StockPrice[],
  asOf: Date,
): StockPrice | null {
  let best: StockPrice | null = null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].fetchedAt.getTime() <= asOf.getTime()) {
      best = sorted[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

export const isStale = (p: StockPrice, asOf: Date): boolean =>
  (asOf.getTime() - p.fetchedAt.getTime()) / DAY > STALE_PRICE_DAYS;

export type YearFlow = {
  year: number;
  /** Whether the year is over; a year in progress closes "today". */
  complete: boolean;
  closedOn: Date;
  open: Held;
  /** Cost of units received during the year. */
  bought: number;
  /** Cost of the units that left during the year. */
  out: number;
  close: Held;
};

/**
 * One item's stock movement over a calendar year. A year still in progress
 * closes at `now`. Costs are in the item's own currency.
 */
export function yearFlow(
  txs: readonly StockTx[],
  year: number,
  method: CostMethod,
  now: Date,
): YearFlow {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = yearEnd(year);
  const complete = end.getTime() < now.getTime();
  const closedOn = complete ? end : now;
  const open = heldOn(txs, new Date(start.getTime() - 1), method);
  const upTo = txs.filter((t) => t.occurredAt.getTime() <= closedOn.getTime());
  const { sells, remaining } = replayForAnalytics(upTo, method);
  const inYear = (d: Date) =>
    d.getTime() >= start.getTime() && d.getTime() <= closedOn.getTime();
  const bought = upTo
    .filter(
      (t) => t.type === "buy" && t.status !== "pending" && inYear(t.occurredAt),
    )
    .reduce((n, t) => n + t.finalValueCents, 0);
  const out = sells
    .filter((s) => inYear(s.sellDate))
    .reduce((n, s) => n + s.consumedCostCents, 0);
  return {
    year,
    complete,
    closedOn,
    open,
    bought,
    out,
    close: {
      qty: remaining.reduce((n, e) => n + e.qty, 0),
      cost: remaining.reduce((n, e) => n + e.cost, 0),
    },
  };
}

/** The reconciling line: how far opening + bought - out is from closing (0 when it adds up). */
export const flowGap = (
  f: Pick<YearFlow, "open" | "bought" | "out" | "close">,
) => f.open.cost + f.bought - f.out - f.close.cost;

/** The years that have any activity, up to and including the current one. */
export function activeYears(
  txs: readonly { occurredAt: Date }[],
  now: Date,
): number[] {
  if (txs.length === 0) return [];
  const first = Math.min(...txs.map((t) => t.occurredAt.getUTCFullYear()));
  const years: number[] = [];
  for (let y = now.getUTCFullYear(); y >= first; y--) years.push(y);
  return years;
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export type StockCsvLine = {
  name: string;
  currency: string;
  qty: number;
  cost: number;
  priceCents: number | null;
  priceAt: Date | null;
};

/**
 * What was held on a day, one row per item, in each item's own currency.
 * `decimal` writes a minor-unit amount as a plain decimal.
 */
export function stockCsv(
  day: string,
  lines: readonly StockCsvLine[],
  decimal: (minor: number, currency: string) => string,
): string {
  const header = [
    "as_of",
    "item",
    "units",
    "cost_basis",
    "price_per_unit",
    "price_date",
    "market_value",
    "currency",
  ].join(",");
  const rows = lines.map((l) =>
    [
      day,
      l.name,
      l.qty,
      decimal(l.cost, l.currency),
      l.priceCents == null ? "" : decimal(l.priceCents, l.currency),
      l.priceAt ? dayOf(l.priceAt) : "",
      l.priceCents == null ? "" : decimal(l.qty * l.priceCents, l.currency),
      l.currency,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}
