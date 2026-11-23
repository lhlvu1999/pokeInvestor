/**
 * Capital deployed: where the money behind your buying actually came from.
 *
 * Total spend alone hides the question that matters for a reseller: how
 * much of it is YOUR money, and how much is earlier sales rolling over?
 * Replay every transaction in time order with one pool of sale proceeds:
 *
 * - a sale adds its proceeds to the pool;
 * - a buy spends from the pool first (that part is "rolled over") and only
 *   the rest is new money out of your pocket.
 *
 * Two assumptions, both stated on the chart:
 * - proceeds are treated as one portfolio-wide pool, not tied to the item
 *   they came from;
 * - transactions with the exact same timestamp are applied sales-first, so
 *   a batch entered at one moment doesn't count as new money when the
 *   proceeds were already in hand. (Imports often share a timestamp.)
 *
 * Pending buys count: the money has left your pocket whether or not the box
 * has arrived.
 *
 * Invariants (checked in the tests against the holdings engine):
 *   spent = lifetime bought, proceeds = lifetime sold,
 *   rolled + pool = proceeds, and ownMoneyIn − pool = spent − proceeds.
 */

import { addMonths, monthsBetween, type MonthKey } from "./cashflow_window";

export type CapitalEvent = {
  at: Date;
  type: "buy" | "sell";
  /** Non-negative, in one currency (the display currency). */
  amount: number;
};

export type CapitalMonth = {
  month: MonthKey;
  /** New money put in this month. */
  fresh: number;
  /** Bought this month with earlier sale proceeds. */
  rolled: number;
  /** Sale proceeds received this month. */
  proceeds: number;
  /** Running totals at the end of the month. */
  ownMoneyIn: number;
  pool: number;
};

export type CapitalFlow = {
  /** Lifetime new money. */
  ownMoneyIn: number;
  /** Lifetime spend funded by sale proceeds. */
  rolled: number;
  /** Lifetime spend (= ownMoneyIn + rolled). */
  spent: number;
  /** Lifetime sale proceeds. */
  proceeds: number;
  /** Proceeds not yet spent on a purchase: taken out, or waiting. */
  pool: number;
  /** rolled / spent, or null before any spending. */
  selfFundedPct: number | null;
  /** Every month from the first to the last with activity, zero-filled. */
  months: CapitalMonth[];
};

function monthOf(d: Date): MonthKey {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}`;
}

export function computeCapitalFlow(
  events: ReadonlyArray<CapitalEvent>,
): CapitalFlow {
  const usable = events.filter((e) => e.amount > 0 || e.type === "sell");
  if (usable.length === 0) {
    return {
      ownMoneyIn: 0,
      rolled: 0,
      spent: 0,
      proceeds: 0,
      pool: 0,
      selfFundedPct: null,
      months: [],
    };
  }

  // Time order; sales before buys at the same instant. Array.sort is stable,
  // so equal events keep their input order.
  const sorted = [...usable].sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      (a.type === b.type ? 0 : a.type === "sell" ? -1 : 1),
  );

  let pool = 0;
  let ownMoneyIn = 0;
  let rolled = 0;
  let proceeds = 0;
  const byMonth = new Map<
    MonthKey,
    { fresh: number; rolled: number; proceeds: number }
  >();
  const bucket = (k: MonthKey) => {
    let b = byMonth.get(k);
    if (!b) byMonth.set(k, (b = { fresh: 0, rolled: 0, proceeds: 0 }));
    return b;
  };

  // Running totals at the end of each month that had activity.
  const endState = new Map<MonthKey, { ownMoneyIn: number; pool: number }>();

  for (const e of sorted) {
    const k = monthOf(e.at);
    const b = bucket(k);
    if (e.type === "sell") {
      pool += e.amount;
      proceeds += e.amount;
      b.proceeds += e.amount;
    } else {
      const fromPool = Math.min(pool, e.amount);
      const fresh = e.amount - fromPool;
      pool -= fromPool;
      rolled += fromPool;
      ownMoneyIn += fresh;
      b.rolled += fromPool;
      b.fresh += fresh;
    }
    endState.set(k, { ownMoneyIn, pool });
  }

  const first = monthOf(sorted[0].at);
  const last = monthOf(sorted[sorted.length - 1].at);
  const months: CapitalMonth[] = [];
  let carry = { ownMoneyIn: 0, pool: 0 };
  for (const k of monthsBetween(first, last)) {
    const b = byMonth.get(k) ?? { fresh: 0, rolled: 0, proceeds: 0 };
    carry = endState.get(k) ?? carry;
    months.push({ month: k, ...b, ...carry });
  }

  const spent = ownMoneyIn + rolled;
  return {
    ownMoneyIn,
    rolled,
    spent,
    proceeds,
    pool,
    selfFundedPct: spent > 0 ? rolled / spent : null,
    months,
  };
}

/** Last `n` months of a flow (the full list when it is shorter). */
export function lastMonths(
  months: ReadonlyArray<CapitalMonth>,
  n: number,
): CapitalMonth[] {
  return months.slice(Math.max(0, months.length - n));
}

/** Month key `n` months after `k`, re-exported for callers building labels. */
export { addMonths };
