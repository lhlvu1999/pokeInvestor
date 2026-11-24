/**
 * Everything the cashflow explorer needs to turn a flat list of
 * (month, item) lines into a chart, a summary and an item breakdown for an
 * arbitrary window of months. Pure, so the rules — window presets, gap
 * filling, axis capping — are testable without rendering anything.
 *
 * Month keys are "YYYY-MM" strings throughout. They compare correctly as
 * plain strings, and sticking to one representation avoids the
 * server/browser timezone drift you get from round-tripping through Date.
 */

export type MonthKey = string;

const MONTH_SHORT = [
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
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(v: unknown): v is MonthKey {
  return typeof v === "string" && MONTH_RE.test(v);
}

function parts(k: MonthKey): { y: number; m: number } {
  return { y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)) };
}

function key(y: number, m: number): MonthKey {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function addMonths(k: MonthKey, n: number): MonthKey {
  const { y, m } = parts(k);
  const idx = y * 12 + (m - 1) + n;
  return key(Math.floor(idx / 12), (((idx % 12) + 12) % 12) + 1);
}

/** Inclusive list of months. Empty when `from` is after `to`. */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let k = from; k <= to; k = addMonths(k, 1)) out.push(k);
  return out;
}

/** "Apr '26" — fixed English names, never locale-dependent, so server and
 * browser render identical text (a locale mismatch is a hydration error). */
export function formatMonthShort(k: MonthKey): string {
  const { y, m } = parts(k);
  return `${MONTH_SHORT[m - 1]} '${String(y).slice(2)}`;
}

/** "April 2026". */
export function formatMonthLong(k: MonthKey): string {
  const { y, m } = parts(k);
  return `${MONTH_LONG[m - 1]} ${y}`;
}

export function currentMonthKey(now: Date): MonthKey {
  return key(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

/* ------------------------------------------------------------------ */
/* Range selection                                                     */
/* ------------------------------------------------------------------ */

export type PresetKind = "3m" | "6m" | "12m" | "all";
export type RangeSpec =
  { kind: PresetKind } | { kind: "custom"; from: MonthKey; to: MonthKey };

/** Recent activity is what you check most, and a short default window also
 * keeps one very large month from flattening the chart on first load. */
export const DEFAULT_RANGE: RangeSpec = { kind: "6m" };

const PRESET_MONTHS: Record<Exclude<PresetKind, "all">, number> = {
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

export function parseRangeParams(p: {
  cf?: string;
  cffrom?: string;
  cfto?: string;
}): RangeSpec {
  if (p.cf === "3m" || p.cf === "6m" || p.cf === "12m" || p.cf === "all") {
    return { kind: p.cf };
  }
  if (p.cf === "custom" && isMonthKey(p.cffrom) && isMonthKey(p.cfto)) {
    return p.cffrom <= p.cfto
      ? { kind: "custom", from: p.cffrom, to: p.cfto }
      : { kind: "custom", from: p.cfto, to: p.cffrom };
  }
  return DEFAULT_RANGE;
}

/** URL params for a range. The default is omitted to keep URLs clean. */
export function rangeToParams(spec: RangeSpec): Record<string, string> {
  if (spec.kind === DEFAULT_RANGE.kind) return {};
  if (spec.kind === "custom") {
    return { cf: "custom", cffrom: spec.from, cfto: spec.to };
  }
  return { cf: spec.kind };
}

/**
 * Turn a range spec into concrete first/last months.
 *
 * A window always ENDS at the current month (or the last month with data,
 * if that is somehow later): "last 3 months" should mean the last three
 * calendar months even if you haven't traded this month — a quiet recent
 * stretch is information, not something to hide. It never STARTS before
 * your first transaction, since leading empty months are just noise.
 */
export function resolveWindow(
  spec: RangeSpec,
  bounds: { first: MonthKey; last: MonthKey },
  nowMonth: MonthKey,
): { from: MonthKey; to: MonthKey } {
  const end = nowMonth > bounds.last ? nowMonth : bounds.last;

  if (spec.kind === "custom") {
    const from = spec.from < bounds.first ? bounds.first : spec.from;
    const to = spec.to > end ? end : spec.to;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  if (spec.kind === "all") return { from: bounds.first, to: end };

  const start = addMonths(end, -(PRESET_MONTHS[spec.kind] - 1));
  return { from: start < bounds.first ? bounds.first : start, to: end };
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

/** Display-currency line, as produced by the server. */
export type WindowLine = {
  month: MonthKey;
  itemId: string;
  itemName: string;
  spend: number;
  revenue: number;
  realized: number;
  shipping: number;
  buys: number;
  sells: number;
  unitsBought: number;
  unitsSold: number;
};

export type MonthTotals = {
  month: MonthKey;
  spend: number;
  revenue: number;
  /** revenue − spend. */
  net: number;
  realized: number;
  shipping: number;
  buys: number;
  sells: number;
  unitsBought: number;
  unitsSold: number;
};

const ZERO = {
  spend: 0,
  revenue: 0,
  net: 0,
  realized: 0,
  shipping: 0,
  buys: 0,
  sells: 0,
  unitsBought: 0,
  unitsSold: 0,
};

/** One entry per month in `months`, zero-filled where nothing happened, so
 * a quiet month shows up as a gap in time instead of vanishing. */
export function buildMonthSeries(
  lines: ReadonlyArray<WindowLine>,
  months: ReadonlyArray<MonthKey>,
): MonthTotals[] {
  const by = new Map<MonthKey, MonthTotals>(
    months.map((month) => [month, { month, ...ZERO }]),
  );
  for (const l of lines) {
    const t = by.get(l.month);
    if (!t) continue;
    t.spend += l.spend;
    t.revenue += l.revenue;
    t.realized += l.realized;
    t.shipping += l.shipping;
    t.buys += l.buys;
    t.sells += l.sells;
    t.unitsBought += l.unitsBought;
    t.unitsSold += l.unitsSold;
  }
  for (const t of by.values()) t.net = t.revenue - t.spend;
  return months.map((m) => by.get(m)!);
}

export function totalsOf(
  series: ReadonlyArray<MonthTotals>,
): Omit<MonthTotals, "month"> {
  const t = { ...ZERO };
  for (const m of series) {
    t.spend += m.spend;
    t.revenue += m.revenue;
    t.realized += m.realized;
    t.shipping += m.shipping;
    t.buys += m.buys;
    t.sells += m.sells;
    t.unitsBought += m.unitsBought;
    t.unitsSold += m.unitsSold;
  }
  t.net = t.revenue - t.spend;
  return t;
}

export type ItemRollup = {
  itemId: string;
  itemName: string;
  /** Money moved: spend for purchases, revenue for sales. */
  amount: number;
  units: number;
  realized: number;
};

function rollup(
  lines: ReadonlyArray<WindowLine>,
  months: ReadonlySet<MonthKey>,
  pick: (l: WindowLine) => { amount: number; units: number },
  n: number,
): ItemRollup[] {
  const by = new Map<string, ItemRollup>();
  for (const l of lines) {
    if (!months.has(l.month)) continue;
    const { amount, units } = pick(l);
    if (amount <= 0 && units <= 0) continue;
    const r = by.get(l.itemId) ?? {
      itemId: l.itemId,
      itemName: l.itemName,
      amount: 0,
      units: 0,
      realized: 0,
    };
    r.amount += amount;
    r.units += units;
    r.realized += l.realized;
    by.set(l.itemId, r);
  }
  return Array.from(by.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

/** Items you spent the most on within the window. */
export function topPurchases(
  lines: ReadonlyArray<WindowLine>,
  months: ReadonlySet<MonthKey>,
  n: number,
): ItemRollup[] {
  return rollup(
    lines,
    months,
    (l) => ({ amount: l.spend, units: l.unitsBought }),
    n,
  );
}

/** Items that brought in the most revenue within the window. */
export function topSales(
  lines: ReadonlyArray<WindowLine>,
  months: ReadonlySet<MonthKey>,
  n: number,
): ItemRollup[] {
  return rollup(
    lines,
    months,
    (l) => ({ amount: l.revenue, units: l.unitsSold }),
    n,
  );
}

/* ------------------------------------------------------------------ */
/* Chart scale                                                         */
/* ------------------------------------------------------------------ */

/** 1 / 2 / 5 × 10ⁿ — round steps that read cleanly as compact currency. */
function niceStep(raw: number): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * exp;
}

/**
 * Pick a cap for one side of the axis so a single huge month doesn't
 * flatten the rest.
 *
 * Only a lone dominant outlier is capped: the largest value must exceed
 * `ratio` × the runner-up. Several large months, or a gently rising
 * series, are real shape and are left alone. Needs ≥3 non-zero values —
 * with fewer there's no "rest" to protect.
 */
export function capMagnitude(
  values: ReadonlyArray<number>,
  ratio = 2.5,
): { max: number; capped: boolean } {
  const v = values.filter((x) => x > 0).sort((a, b) => b - a);
  if (v.length === 0) return { max: 0, capped: false };
  if (v.length < 3 || v[0] <= ratio * v[1]) return { max: v[0], capped: false };
  // Headroom above the runner-up so its bar isn't flush with the top.
  return { max: v[1] * 1.15, capped: true };
}

export type ChartDomain = {
  lo: number; // ≤ 0
  hi: number; // ≥ 0
  ticks: number[];
};

/** Round the domain out to clean tick values. `up` and `down` are the
 * largest magnitudes drawn above and below zero. */
export function niceDomain(up: number, down: number, count = 4): ChartDomain {
  if (up <= 0 && down <= 0) return { lo: 0, hi: 1, ticks: [0, 1] };
  const step = niceStep((up + down) / count);
  const hi = Math.ceil(up / step) * step;
  // `0 -` rather than a unary minus so an empty down side is +0, not -0.
  const lo = 0 - Math.ceil(down / step) * step;
  const ticks: number[] = [];
  const first = Math.round(lo / step);
  const last = Math.round(hi / step);
  for (let i = first; i <= last; i++) ticks.push(i * step);
  return { lo, hi, ticks };
}
