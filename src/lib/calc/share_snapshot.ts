/**
 * A snapshot of your holdings that you can send to someone: a file, or text.
 *
 * Privacy is enforced by construction, not by hiding things afterwards.
 * `buildSnapshot` is the only place that sees cost basis, and it copies a
 * field into the result only when its switch is on. The renderers receive
 * that result and nothing else, so a number that wasn't chosen cannot reach
 * the output. Cost and profit are off by default.
 *
 * This is a snapshot you send, not a link: the app has no login, so a link
 * would protect nothing. What the recipient gets is exactly what the
 * preview shows.
 */

export type ShareLine = {
  itemId: string;
  name: string;
  tags: string[];
  /** Units in hand. Only held items are shared. */
  quantity: number;
  /** Latest market price per unit; null when the item has never been priced. */
  marketUnit: number | null;
  /** Private. Average cost per held unit. */
  avgCost: number;
};

export type ShareOptions = {
  title: string;
  showQuantity: boolean;
  showUnitPrice: boolean;
  showValue: boolean;
  /** Private: off unless chosen. */
  showCost: boolean;
  /** Private: off unless chosen. */
  showProfit: boolean;
  /** Only items carrying this tag; null = everything held. */
  tag: string | null;
};

export const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  title: "My Pokémon collection",
  showQuantity: true,
  showUnitPrice: true,
  showValue: true,
  showCost: false,
  showProfit: false,
  tag: null,
};

export type SnapshotRow = {
  name: string;
  quantity?: number;
  /** Null = no market price. Present only when the column is shown. */
  unitPrice?: number | null;
  value?: number | null;
  cost?: number;
  profit?: number | null;
};

export type ColumnKey = "quantity" | "unitPrice" | "value" | "cost" | "profit";

export type Snapshot = {
  title: string;
  asOf: Date;
  currency: string;
  /** Which columns are shown, in order. */
  columns: ColumnKey[];
  rows: SnapshotRow[];
  totals: {
    items: number;
    units?: number;
    value?: number;
    cost?: number;
    profit?: number;
  };
  /** Held items with no market price, so left out of value and profit. */
  unpriced: number;
  /** Plain statements of what is and isn't in the snapshot. */
  includes: string[];
  excludes: string[];
};

const MAX_TITLE = 120;

export function cleanTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return t === "" ? DEFAULT_SHARE_OPTIONS.title : t;
}

export function buildSnapshot(
  lines: ReadonlyArray<ShareLine>,
  options: ShareOptions,
  currency: string,
  asOf: Date,
): Snapshot {
  const o = options;
  const chosen = lines.filter(
    (l) => l.quantity > 0 && (o.tag == null || l.tags.includes(o.tag)),
  );
  // Value order would reveal a ranking the viewer wasn't given, so it is
  // only used when values are shown.
  const sorted = [...chosen].sort((a, b) => {
    if (o.showValue) {
      const av = a.marketUnit == null ? -1 : a.marketUnit * a.quantity;
      const bv = b.marketUnit == null ? -1 : b.marketUnit * b.quantity;
      if (av !== bv) return bv - av;
    }
    return a.name.localeCompare(b.name);
  });

  const rows: SnapshotRow[] = sorted.map((l) => {
    const row: SnapshotRow = { name: l.name };
    if (o.showQuantity) row.quantity = l.quantity;
    if (o.showUnitPrice) row.unitPrice = l.marketUnit;
    if (o.showValue)
      row.value = l.marketUnit == null ? null : l.marketUnit * l.quantity;
    if (o.showCost) row.cost = l.avgCost * l.quantity;
    if (o.showProfit)
      row.profit =
        l.marketUnit == null
          ? null
          : l.marketUnit * l.quantity - l.avgCost * l.quantity;
    return row;
  });

  const totals: Snapshot["totals"] = { items: chosen.length };
  if (o.showQuantity) totals.units = chosen.reduce((n, l) => n + l.quantity, 0);
  if (o.showValue)
    totals.value = chosen.reduce(
      (n, l) => n + (l.marketUnit == null ? 0 : l.marketUnit * l.quantity),
      0,
    );
  if (o.showCost)
    totals.cost = chosen.reduce((n, l) => n + l.avgCost * l.quantity, 0);
  if (o.showProfit)
    totals.profit = chosen.reduce(
      (n, l) =>
        n +
        (l.marketUnit == null ? 0 : (l.marketUnit - l.avgCost) * l.quantity),
      0,
    );

  const columns: ColumnKey[] = [];
  if (o.showQuantity) columns.push("quantity");
  if (o.showUnitPrice) columns.push("unitPrice");
  if (o.showValue) columns.push("value");
  if (o.showCost) columns.push("cost");
  if (o.showProfit) columns.push("profit");

  const includes = ["Item names"];
  if (o.showQuantity) includes.push("Quantities");
  if (o.showUnitPrice) includes.push("Market price per unit");
  if (o.showValue) includes.push("Value at market price");
  if (o.showCost) includes.push("What you paid");
  if (o.showProfit) includes.push("Profit or loss");
  const excludes: string[] = [];
  if (!o.showCost) excludes.push("What you paid");
  if (!o.showProfit) excludes.push("Profit or loss");
  excludes.push(
    "Transactions, dates, notes, tags, sources and everything else in the app",
  );

  return {
    title: cleanTitle(o.title),
    asOf,
    currency,
    columns,
    rows,
    totals,
    unpriced: chosen.filter((l) => l.marketUnit == null).length,
    includes,
    excludes,
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export type MoneyFormat = (minor: number) => string;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  quantity: "Qty",
  unitPrice: "Market price",
  value: "Value",
  cost: "Paid",
  profit: "Profit",
};

type Column = { key: ColumnKey; label: string };

function columnsOf(s: Snapshot): Column[] {
  return s.columns.map((key) => ({ key, label: COLUMN_LABELS[key] }));
}

function cell(row: SnapshotRow, key: ColumnKey, money: MoneyFormat): string {
  const v = row[key];
  if (v == null) return "—";
  if (key === "quantity") return String(v);
  if (typeof v === "number") {
    const text = money(Math.abs(v));
    return key === "profit" ? `${v < 0 ? "−" : v > 0 ? "+" : ""}${text}` : text;
  }
  return String(v);
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function footnotes(s: Snapshot): string[] {
  const notes = [
    "Prices are market estimates from eBay listings, not offers to buy or sell.",
  ];
  if (s.unpriced > 0)
    notes.push(
      `${s.unpriced} ${s.unpriced === 1 ? "item has" : "items have"} no market price yet and ${s.unpriced === 1 ? "is" : "are"} left out of the totals.`,
    );
  return notes;
}

export function renderSnapshotText(s: Snapshot, money: MoneyFormat): string {
  const cols = columnsOf(s);
  const out: string[] = [s.title, `As of ${dateLabel(s.asOf)}`, ""];
  for (const r of s.rows) {
    const bits = cols.map((c) => {
      const t = cell(r, c.key, money);
      return c.key === "quantity" ? `${t}×` : `${c.label.toLowerCase()} ${t}`;
    });
    out.push(`${r.name}${bits.length ? ` — ${bits.join(", ")}` : ""}`);
  }
  out.push("");
  const t: string[] = [
    `${s.totals.items} ${s.totals.items === 1 ? "item" : "items"}`,
  ];
  if (s.totals.units !== undefined) t.push(`${s.totals.units} units`);
  if (s.totals.value !== undefined) t.push(`worth ${money(s.totals.value)}`);
  if (s.totals.cost !== undefined) t.push(`paid ${money(s.totals.cost)}`);
  if (s.totals.profit !== undefined)
    t.push(
      `profit ${s.totals.profit < 0 ? "−" : s.totals.profit > 0 ? "+" : ""}${money(Math.abs(s.totals.profit))}`,
    );
  out.push(`Total: ${t.join(", ")}`);
  out.push("", ...footnotes(s));
  return out.join("\n");
}

/** A complete, self-contained HTML page. All user text is escaped. */
export function renderSnapshotHtml(s: Snapshot, money: MoneyFormat): string {
  const cols = columnsOf(s);
  const head = ["Item", ...cols.map((c) => c.label)]
    .map((h, i) => `<th class="${i === 0 ? "l" : "r"}">${escapeHtml(h)}</th>`)
    .join("");
  const body = s.rows
    .map(
      (r) =>
        `<tr><td class="l">${escapeHtml(r.name)}</td>${cols
          .map((c) => `<td class="r">${escapeHtml(cell(r, c.key, money))}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const foot: string[] = [];
  const totalCell = (key: ColumnKey): string => {
    if (key === "quantity" && s.totals.units !== undefined)
      return String(s.totals.units);
    if (key === "value" && s.totals.value !== undefined)
      return money(s.totals.value);
    if (key === "cost" && s.totals.cost !== undefined)
      return money(s.totals.cost);
    if (key === "profit" && s.totals.profit !== undefined) {
      const p = s.totals.profit;
      return `${p < 0 ? "−" : p > 0 ? "+" : ""}${money(Math.abs(p))}`;
    }
    return "";
  };
  if (cols.length > 0)
    foot.push(
      `<tr class="t"><td class="l">Total · ${s.totals.items} ${s.totals.items === 1 ? "item" : "items"}</td>${cols
        .map((c) => `<td class="r">${escapeHtml(totalCell(c.key))}</td>`)
        .join("")}</tr>`,
    );
  const notes = footnotes(s)
    .map((n) => `<p class="n">${escapeHtml(n)}</p>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(s.title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#18181b;background:#fff;margin:0;padding:24px;line-height:1.45}
main{max-width:720px;margin:0 auto}
h1{font-size:22px;margin:0 0 2px}
.d{color:#71717a;font-size:13px;margin:0 0 18px}
table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#71717a;font-weight:500;padding:6px 8px;border-bottom:1px solid #e4e4e7}
td{padding:7px 8px;border-bottom:1px solid #f4f4f5}
.l{text-align:left}.r{text-align:right;white-space:nowrap}
tr.t td{font-weight:600;border-top:2px solid #18181b;border-bottom:0}
.n{color:#71717a;font-size:12px;margin:10px 0 0}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(s.title)}</h1>
<p class="d">As of ${escapeHtml(dateLabel(s.asOf))}</p>
<table>
<thead><tr>${head}</tr></thead>
<tbody>${body}</tbody>
<tfoot>${foot.join("")}</tfoot>
</table>
${notes}
</main>
</body>
</html>
`;
}

export function snapshotFilename(s: Snapshot): string {
  const slug = s.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `${slug || "collection"}-${s.asOf.toISOString().slice(0, 10)}.html`;
}
