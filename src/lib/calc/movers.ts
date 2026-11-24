/**
 * Pick the biggest price movers from a set of positions.
 *
 * Lives apart from `price_analytics.ts` (which reads the DB) so the
 * selection rules can be unit-tested.
 *
 * `minSpanDays` exists because a "change" measured across a few minutes
 * is not a market move. It happens right after a bulk refresh, when a
 * re-run with a better search query reprices an item against its own
 * earlier, worse estimate. Without the guard those artifacts rank as the
 * day's biggest movers and become the first thing on the dashboard.
 */

export type MoverCandidate = {
  change: { changePct: number; spanDays: number } | null;
};

export type Movers<T> = { gainers: T[]; losers: T[] };

export function pickMovers<T extends MoverCandidate>(
  rows: ReadonlyArray<T>,
  opts: { topN: number; minSpanDays: number },
): Movers<T> {
  const eligible = rows.filter(
    (r): r is T & { change: NonNullable<T["change"]> } =>
      r.change != null && r.change.spanDays >= opts.minSpanDays,
  );

  const gainers = eligible
    .filter((r) => r.change.changePct > 0)
    .sort((a, b) => b.change.changePct - a.change.changePct)
    .slice(0, opts.topN);

  // Worst first, so the loss that matters most leads the list.
  const losers = eligible
    .filter((r) => r.change.changePct < 0)
    .sort((a, b) => a.change.changePct - b.change.changePct)
    .slice(0, opts.topN);

  return { gainers, losers };
}
