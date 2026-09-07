/**
 * Derivations over an item's `market_prices` time series.
 *
 * The series is irregular by nature — a price only exists on days the
 * user (or a cron) actually refreshed. So "price 30 days ago" means
 * "the most recent snapshot at or before that date", not "the snapshot
 * dated exactly then". Everything here is last-observation-carried-
 * forward for that reason.
 */

export type PricePoint = {
  fetchedAt: Date;
  priceCents: number;
};

export type PriceChange = {
  currentCents: number;
  currentAt: Date;
  /** Price at the lookback horizon, carried forward. */
  priorCents: number;
  priorAt: Date;
  /** (current - prior) / prior, as a fraction. 0.12 = +12%. */
  changePct: number;
  /** Days between the two observations actually used. Can exceed the
   * requested window when snapshots are sparse — surfaced so the UI can
   * say "over 47d" rather than implying a clean 30d. */
  spanDays: number;
};

/** Ascending by time. Does not mutate the input. */
export function sortAscending(
  history: ReadonlyArray<PricePoint>,
): PricePoint[] {
  return [...history].sort(
    (a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime(),
  );
}

/** Most recent snapshot, or null when the series is empty. */
export function latestPrice(
  history: ReadonlyArray<PricePoint>,
): PricePoint | null {
  if (history.length === 0) return null;
  const sorted = sortAscending(history);
  return sorted[sorted.length - 1];
}

/**
 * Last snapshot at or before `date`. Null when the series starts after
 * `date` — i.e. we simply weren't tracking the item back then, which is
 * different from "the price was zero".
 */
export function priceAsOf(
  history: ReadonlyArray<PricePoint>,
  date: Date,
): PricePoint | null {
  const ts = date.getTime();
  let best: PricePoint | null = null;
  for (const p of history) {
    if (p.fetchedAt.getTime() > ts) continue;
    if (!best || p.fetchedAt.getTime() > best.fetchedAt.getTime()) best = p;
  }
  return best;
}

const MS_PER_DAY = 86_400_000;

/**
 * Percentage change over the trailing `windowDays`.
 *
 * Returns null when there is nothing meaningful to compare — a single
 * snapshot, or a prior price of zero (which would make the percentage
 * infinite). A caller showing "movers" should treat null as "not enough
 * history yet", not as 0%.
 */
export function changeOverDays(
  history: ReadonlyArray<PricePoint>,
  windowDays: number,
): PriceChange | null {
  const current = latestPrice(history);
  if (!current) return null;

  const horizon = new Date(
    current.fetchedAt.getTime() - windowDays * MS_PER_DAY,
  );
  let prior = priceAsOf(history, horizon);

  // Nothing at or before the horizon: fall back to the OLDEST snapshot we
  // do have, so a young series still yields a signal. The reported
  // spanDays makes the shorter window explicit.
  if (!prior || prior.fetchedAt.getTime() === current.fetchedAt.getTime()) {
    const sorted = sortAscending(history);
    prior = sorted[0];
  }

  if (!prior) return null;
  if (prior.fetchedAt.getTime() === current.fetchedAt.getTime()) return null;
  if (prior.priceCents === 0) return null;

  return {
    currentCents: current.priceCents,
    currentAt: current.fetchedAt,
    priorCents: prior.priceCents,
    priorAt: prior.fetchedAt,
    changePct:
      (current.priceCents - prior.priceCents) / Math.abs(prior.priceCents),
    spanDays:
      (current.fetchedAt.getTime() - prior.fetchedAt.getTime()) / MS_PER_DAY,
  };
}

/**
 * Min/max/first/last over the series — enough to render a sparkline
 * without the component re-deriving it.
 */
export type SeriesBounds = {
  minCents: number;
  maxCents: number;
  firstCents: number;
  lastCents: number;
  count: number;
};

export function seriesBounds(
  history: ReadonlyArray<PricePoint>,
): SeriesBounds | null {
  if (history.length === 0) return null;
  const sorted = sortAscending(history);
  let min = sorted[0].priceCents;
  let max = sorted[0].priceCents;
  for (const p of sorted) {
    if (p.priceCents < min) min = p.priceCents;
    if (p.priceCents > max) max = p.priceCents;
  }
  return {
    minCents: min,
    maxCents: max,
    firstCents: sorted[0].priceCents,
    lastCents: sorted[sorted.length - 1].priceCents,
    count: sorted.length,
  };
}
