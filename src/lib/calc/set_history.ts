/**
 * Price history helpers for the Sets pages: how much something changed over a
 * window, and how to turn a long daily series into a chart that stays light.
 *
 * Days are YYYY-MM-DD strings and money is whole US cents. A "series" is
 * ascending by day.
 */

export type Point = { day: string; cents: number };

const DAY_MS = 86_400_000;

/** Whole days between two YYYY-MM-DD strings (b − a). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / DAY_MS);
}

/**
 * Change from the price `days` days before the newest point to the newest
 * point, as a fraction (0.12 = +12%).
 *
 * The comparison price is the latest one on or before the target day. If the
 * series doesn't reach back that far there is no honest answer, so this
 * returns null rather than comparing against whatever the oldest point is.
 * A zero or missing starting price also gives null (no percentage of zero).
 */
export function changeOver(
  series: ReadonlyArray<Point>,
  days: number,
): number | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  let base: Point | null = null;
  for (const p of series) {
    if (daysBetween(p.day, last.day) >= days) base = p;
    else break;
  }
  if (!base || base.cents <= 0) return null;
  return last.cents / base.cents - 1;
}

/**
 * Keep at most `max` points, always including the first and the last, spread
 * evenly. A year of daily points doesn't need to be drawn point by point.
 */
export function downsample<T>(items: ReadonlyArray<T>, max: number): T[] {
  if (max < 2 || items.length <= max) return [...items];
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  let prev = -1;
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * step);
    if (idx !== prev) out.push(items[idx]);
    prev = idx;
  }
  return out;
}

export type Scaled = { x: number; y: number };

/**
 * Map points to SVG coordinates. X is by real date (so gaps in the data show
 * as gaps, not as evenly spaced points); Y is padded so the line doesn't sit
 * on the edge. With a flat series the line is drawn mid-height.
 */
export function scaleSeries(
  series: ReadonlyArray<Point>,
  width: number,
  height: number,
  domain?: { min: number; max: number },
): Scaled[] {
  if (series.length === 0) return [];
  const first = series[0].day;
  const span = Math.max(1, daysBetween(first, series[series.length - 1].day));
  const lo = domain?.min ?? Math.min(...series.map((p) => p.cents));
  const hi = domain?.max ?? Math.max(...series.map((p) => p.cents));
  const range = hi - lo;
  return series.map((p) => ({
    x:
      series.length === 1
        ? width / 2
        : (daysBetween(first, p.day) / span) * width,
    y: range === 0 ? height / 2 : height - ((p.cents - lo) / range) * height,
  }));
}

/** "M x,y L x,y …" for an SVG path; empty when there is nothing to draw. */
export function linePath(points: ReadonlyArray<Scaled>): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}

/** The value range shared by several series, so lines are comparable. */
export function sharedDomain(
  ...all: ReadonlyArray<ReadonlyArray<Point>>
): { min: number; max: number } | null {
  const values = all.flat().map((p) => p.cents);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Drop the leading days before a set was properly priced.
 *
 * A set is often listed weeks before release with few or no priced cards, so
 * its early "value" is near zero and then leaps at launch; drawn as is, that
 * cliff swamps the real story. Keep the series from the first day on which at
 * least `minShare` of today's priced-card count is priced. If no day ever
 * reaches that, everything is kept (there is nothing better to show).
 */
export function fromLaunch<T extends { priced: number }>(
  series: ReadonlyArray<T>,
  minShare = 0.5,
): T[] {
  if (series.length === 0) return [];
  const latest = series[series.length - 1].priced;
  const threshold = Math.max(1, Math.ceil(latest * minShare));
  const start = series.findIndex((p) => p.priced >= threshold);
  return start === -1 ? [...series] : series.slice(start);
}
