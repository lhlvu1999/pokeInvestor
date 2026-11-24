/**
 * Annualized return: "what yearly rate would have turned the money I put in,
 * WHEN I put it in, into what I have now?"
 *
 * That is a money-weighted return (IRR / XIRR). It is the right measure for a
 * reseller because the money goes in and out at irregular times: a plain
 * "profit ÷ spent" ignores that ₫100M sat in boxes for a year while another
 * ₫100M was spent last week.
 *
 * Cash flows, from the owner's side:
 * - a buy is money OUT on its date (pending buys count: the money is gone);
 * - a sale is money IN on its date (gifts / lost / opened are sales for ₫0,
 *   so they stay in as the loss they are);
 * - what is still held is treated as cashed out today at `terminalValue`.
 *
 * Two honesty gates:
 * - Nothing is shown before MIN_DAYS of history. Annualizing a few weeks
 *   turns noise into a four-digit percentage.
 * - Under a year, the figure is flagged as extrapolated.
 *
 * Rates use Excel's XIRR convention (days ÷ 365), so the result can be
 * checked against a spreadsheet.
 */

/** History needed before an annualized figure is shown at all. */
export const MIN_DAYS = 90;
/** Below this the rate is a projection beyond the data, so it is flagged. */
export const FULL_YEAR_DAYS = 365;

const MS_PER_DAY = 86_400_000;

export type CashFlow = {
  at: Date;
  /** Positive = money to you, negative = money from you. Minor units. */
  amount: number;
};

export type ReturnEvent = {
  at: Date;
  type: "buy" | "sell";
  /** Non-negative. */
  amount: number;
};

export type XirrResult =
  | { ok: true; rate: number }
  | { ok: false; reason: "no_root" | "ambiguous" | "invalid" };

function dayCount(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

/**
 * Solve Σ amount·(1+r)^(−t) = 0 for r, with t in years from the first flow.
 *
 * Works in x = ln(1+r) so the search is over all rates from −99.9% up to
 * +100,000% on an even grid. A grid scan plus bisection is slower than
 * Newton's method but cannot wander off to a nonsense root, and it can tell
 * "no answer" from "more than one answer" (mixed in/out flows can have
 * several). An ambiguous result is reported as such, never guessed at.
 */
export function xirr(flows: ReadonlyArray<CashFlow>): XirrResult {
  const usable = flows.filter(
    (f) => f.amount !== 0 && Number.isFinite(f.amount),
  );
  if (usable.length < 2) return { ok: false, reason: "invalid" };
  const hasIn = usable.some((f) => f.amount > 0);
  const hasOut = usable.some((f) => f.amount < 0);
  if (!hasIn || !hasOut) return { ok: false, reason: "no_root" };

  const sorted = [...usable].sort((a, b) => a.at.getTime() - b.at.getTime());
  const t0 = sorted[0].at;
  const terms = sorted.map((f) => ({
    amount: f.amount,
    years: dayCount(t0, f.at) / 365,
  }));
  if (terms[terms.length - 1].years === 0) {
    // Everything on one day: no time has passed, so no annual rate exists.
    return { ok: false, reason: "invalid" };
  }

  const f = (x: number) => {
    let sum = 0;
    for (const t of terms) sum += t.amount * Math.exp(-x * t.years);
    return sum;
  };

  const X_MIN = Math.log(0.001); // −99.9%
  const X_MAX = Math.log(1001); // +100,000%
  const STEPS = 4000;
  const roots: number[] = [];
  let prevX = X_MIN;
  let prevF = f(prevX);
  for (let i = 1; i <= STEPS; i++) {
    const x = X_MIN + ((X_MAX - X_MIN) * i) / STEPS;
    const fx = f(x);
    if (prevF === 0) {
      roots.push(prevX);
    } else if (prevF * fx < 0) {
      let lo = prevX;
      let hi = x;
      let flo = prevF;
      for (let k = 0; k < 100; k++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (fm === 0) {
          lo = hi = mid;
          break;
        }
        if (flo * fm < 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      roots.push((lo + hi) / 2);
    }
    prevX = x;
    prevF = fx;
  }
  if (prevF === 0) roots.push(prevX);

  if (roots.length === 0) return { ok: false, reason: "no_root" };
  // Roots that agree to a hair are one root found on both sides of a grid
  // line, not two answers.
  const distinct = roots.filter(
    (r, i) => i === 0 || Math.abs(r - roots[i - 1]) > 1e-6,
  );
  if (distinct.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, rate: Math.exp(distinct[0]) - 1 };
}

export type ReturnReport =
  | { status: "none" }
  | {
      status: "too_early";
      firstAt: Date;
      /** Days of history so far. */
      days: number;
      /** First day the figure appears. */
      unlocksAt: Date;
      daysToGo: number;
    }
  | {
      status: "unavailable";
      firstAt: Date;
      days: number;
      reason: "no_root" | "ambiguous" | "invalid";
    }
  | {
      status: "ok";
      firstAt: Date;
      days: number;
      /** Yearly rate as a fraction (0.34 = +34%/yr). */
      annualized: number;
      /** True when history is under a year: the rate is extrapolated. */
      extrapolated: boolean;
      /** (all sale proceeds + value still held) ÷ everything spent. */
      multiple: number;
      spent: number;
      proceeds: number;
      terminalValue: number;
      /** Profit on this basis: proceeds + terminal − spent. */
      profit: number;
    };

/**
 * Build the report from every buy and sell plus today's value of what is
 * still held. `terminalValue` must already include everything not sold
 * (priced stock at market, unpriced and on-the-way stock at cost).
 */
export function computeReturn(
  events: ReadonlyArray<ReturnEvent>,
  terminalValue: number,
  now: Date,
): ReturnReport {
  const dated = events.filter((e) => e.amount > 0 || e.type === "sell");
  if (dated.length === 0) return { status: "none" };

  let firstAt = dated[0].at;
  for (const e of dated) if (e.at < firstAt) firstAt = e.at;
  const days = Math.max(0, Math.floor(dayCount(firstAt, now)));

  if (days < MIN_DAYS) {
    const unlocksAt = new Date(firstAt.getTime() + MIN_DAYS * MS_PER_DAY);
    return {
      status: "too_early",
      firstAt,
      days,
      unlocksAt,
      daysToGo: MIN_DAYS - days,
    };
  }

  let spent = 0;
  let proceeds = 0;
  const flows: CashFlow[] = [];
  for (const e of dated) {
    if (e.type === "buy") {
      spent += e.amount;
      flows.push({ at: e.at, amount: -e.amount });
    } else {
      proceeds += e.amount;
      flows.push({ at: e.at, amount: e.amount });
    }
  }
  flows.push({ at: now, amount: terminalValue });

  if (spent <= 0) {
    return { status: "unavailable", firstAt, days, reason: "invalid" };
  }
  const solved = xirr(flows);
  if (!solved.ok) {
    return { status: "unavailable", firstAt, days, reason: solved.reason };
  }
  return {
    status: "ok",
    firstAt,
    days,
    annualized: solved.rate,
    extrapolated: days < FULL_YEAR_DAYS,
    multiple: (proceeds + terminalValue) / spent,
    spent,
    proceeds,
    terminalValue,
    profit: proceeds + terminalValue - spent,
  };
}
