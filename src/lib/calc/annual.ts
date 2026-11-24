/**
 * Yearly sales report: every unit that left stock, with what it brought in and
 * what it cost, grouped by calendar year.
 *
 * Cost is whatever the chosen cost method says the sold units cost (the same
 * replay the rest of the app uses), so the yearly totals add up to the lifetime
 * realized figure on the Analytics page. Years follow UTC dates, like the
 * monthly cashflow, so a sale logged at 00:30 local time can land on the
 * previous UTC day.
 *
 * A sale is a unit that went to a buyer. A gift, a loss or a pack opened is a
 * write-off: it is in the net figure but kept out of the sale counts and the
 * win rate, as elsewhere in the app.
 */

export type SaleLine = {
  txId: string;
  itemId: string;
  itemName: string;
  soldOn: Date;
  qty: number;
  /** "sold" for a real sale, otherwise the write-off reason. */
  reason: string;
  /** Amounts in the item's own currency (minor units). */
  proceeds: number;
  cost: number;
  realized: number;
  currency: string;
  daysHeld: number;
  /** The same amounts in the display currency; null when no rate was found. */
  shown: { proceeds: number; cost: number; realized: number } | null;
  /** True when some part of `shown` used today's exchange rate, not its own day's. */
  approx?: boolean;
};

export type YearSummary = {
  year: number;
  /** Sales to a buyer (not write-offs). */
  sales: number;
  units: number;
  proceeds: number;
  cost: number;
  /** Profit on sales alone. */
  profit: number;
  /** Realized result of gifts, losses and opened packs (usually negative). */
  writeOffs: number;
  writeOffUnits: number;
  /** profit + writeOffs: the figure that adds up to lifetime realized. */
  net: number;
  winners: number;
  losers: number;
  /** Lines left out of the money figures because no rate was found. */
  unconverted: number;
  /** Lines in the figures that used today's rate for some part (no rate for that day). */
  approx: number;
};

export const yearOf = (d: Date): number => d.getUTCFullYear();

export const isSaleLine = (l: Pick<SaleLine, "reason">): boolean =>
  l.reason === "sold";

/** One row per year with sales or write-offs, newest first. */
export function summarizeYears(lines: readonly SaleLine[]): YearSummary[] {
  const byYear = new Map<number, YearSummary>();
  for (const l of lines) {
    const y = yearOf(l.soldOn);
    let s = byYear.get(y);
    if (!s) {
      s = {
        year: y,
        sales: 0,
        units: 0,
        proceeds: 0,
        cost: 0,
        profit: 0,
        writeOffs: 0,
        writeOffUnits: 0,
        net: 0,
        winners: 0,
        losers: 0,
        unconverted: 0,
        approx: 0,
      };
      byYear.set(y, s);
    }
    if (!l.shown) {
      s.unconverted += 1;
      continue;
    }
    if (l.approx) s.approx += 1;
    if (isSaleLine(l)) {
      s.sales += 1;
      s.units += l.qty;
      s.proceeds += l.shown.proceeds;
      s.cost += l.shown.cost;
      s.profit += l.shown.realized;
      if (l.shown.realized > 0) s.winners += 1;
      else if (l.shown.realized < 0) s.losers += 1;
    } else {
      s.writeOffUnits += l.qty;
      s.writeOffs += l.shown.realized;
    }
    s.net = s.profit + s.writeOffs;
  }
  return [...byYear.values()].sort((a, b) => b.year - a.year);
}

/**
 * Share of sales that made money, or null when there were none. A sale that
 * broke even counts as not winning, the same as on the Analytics page.
 */
export function winRate(s: Pick<YearSummary, "winners" | "sales">) {
  return s.sales === 0 ? null : s.winners / s.sales;
}

/** Profit as a share of what the sold units cost; null when nothing was spent. */
export function margin(s: Pick<YearSummary, "profit" | "cost">) {
  return s.cost > 0 ? s.profit / s.cost : null;
}

/** The year in the URL, if it is one the report has data for. */
export function parseYear(
  raw: string | string[] | undefined,
  available: readonly number[],
): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d{4}$/.test(v)) return null;
  const y = Number(v);
  return available.includes(y) ? y : null;
}

export function linesOfYear(
  lines: readonly SaleLine[],
  year: number,
): SaleLine[] {
  return lines
    .filter((l) => yearOf(l.soldOn) === year)
    .sort((a, b) => a.soldOn.getTime() - b.soldOn.getTime());
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Spreadsheet-friendly sales ledger. Amounts stay in each item's own currency
 * (the money actually exchanged), as plain decimals; the caller supplies how to
 * write a minor-unit amount because that depends on the currency.
 */
export function salesCsv(
  lines: readonly SaleLine[],
  decimal: (minor: number, currency: string) => string,
): string {
  const header = [
    "date",
    "item",
    "quantity",
    "kind",
    "proceeds",
    "cost_basis",
    "profit",
    "currency",
    "days_held",
  ].join(",");
  const rows = lines.map((l) =>
    [
      l.soldOn.toISOString().slice(0, 10),
      l.itemName,
      l.qty,
      l.reason,
      decimal(l.proceeds, l.currency),
      decimal(l.cost, l.currency),
      decimal(l.realized, l.currency),
      l.currency,
      Math.round(l.daysHeld),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}
