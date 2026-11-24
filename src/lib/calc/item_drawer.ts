/**
 * Pure helpers behind the item drawer's price chart: which part of the
 * history to show for a chosen range, and how to scale it.
 *
 * All times are epoch milliseconds so the data can cross the server →
 * browser JSON boundary without Date revival.
 */

export type DrawerPoint = { t: number; price: number };
export type DrawerTrade = {
  t: number;
  type: "buy" | "sell";
  qty: number;
  /** Per-unit price paid / received, in the same currency as the points. */
  unit: number;
};

export type DrawerRange = "3m" | "6m" | "12m" | "all";

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<Exclude<DrawerRange, "all">, number> = {
  "3m": 91,
  "6m": 182,
  "12m": 365,
};

export const DRAWER_RANGES: { value: DrawerRange; label: string }[] = [
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "12m", label: "12M" },
  { value: "all", label: "All" },
];

/**
 * The slice of history inside `range` ending at `now`.
 *
 * A price series is irregular — a snapshot only exists on days a refresh
 * ran — so the line must be anchored at the window's left edge. We keep the
 * last snapshot at or before the cutoff (its value is what the price WAS at
 * the start) and move it to the cutoff, rather than starting the line at the
 * first snapshot that happens to fall inside.
 */
export function windowSeries(
  points: ReadonlyArray<DrawerPoint>,
  trades: ReadonlyArray<DrawerTrade>,
  range: DrawerRange,
  now: number,
): { points: DrawerPoint[]; trades: DrawerTrade[]; from: number; to: number } {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const to = Math.max(now, sorted[sorted.length - 1]?.t ?? now);
  if (range === "all" || sorted.length === 0) {
    const from = sorted[0]?.t ?? now;
    return { points: sorted, trades: [...trades], from, to };
  }
  const from = to - RANGE_DAYS[range] * DAY_MS;

  const inside = sorted.filter((p) => p.t >= from);
  const before = [...sorted].reverse().find((p) => p.t < from);
  const out: DrawerPoint[] = [];
  if (before && (inside.length === 0 || inside[0].t > from)) {
    out.push({ t: from, price: before.price });
  }
  out.push(...inside);
  return {
    points: out,
    trades: trades.filter((tr) => tr.t >= from && tr.t <= to),
    from,
    to,
  };
}

/**
 * Padded y-range around the prices and trade dots, so a $150 product's
 * moves aren't flattened by a zero-based axis. Never degenerate.
 */
export function priceDomain(
  points: ReadonlyArray<DrawerPoint>,
  trades: ReadonlyArray<DrawerTrade>,
): { lo: number; hi: number } {
  const values = [...points.map((p) => p.price), ...trades.map((t) => t.unit)];
  if (values.length === 0) return { lo: 0, hi: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pad = span === 0 ? Math.max(1, Math.abs(max) * 0.05) : span * 0.12;
  return { lo: Math.max(0, min - pad), hi: max + pad };
}

/** Change from the first to the last point, as a fraction; null if undefined. */
export function changeOver(points: ReadonlyArray<DrawerPoint>): number | null {
  if (points.length < 2) return null;
  const first = points[0].price;
  const last = points[points.length - 1].price;
  if (first <= 0) return null;
  return last / first - 1;
}

/** Index of the point nearest to time `t`, or -1 for an empty series. */
export function nearestIndex(
  points: ReadonlyArray<DrawerPoint>,
  t: number,
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(points[i].t - t);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "23 Nov '26" — fixed English and UTC, so server and browser agree. */
export function formatDay(t: number): string {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} '${String(
    d.getUTCFullYear(),
  ).slice(2)}`;
}
