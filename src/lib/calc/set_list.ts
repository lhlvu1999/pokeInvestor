/**
 * Filtering and ordering for the Sets list. Pure, so the rules (what "newest"
 * means, where unknowns sort, what "has prices" means) are tested rather than
 * buried in a component.
 */

export type SetSort = "newest" | "value" | "top20" | "change" | "name";
export type SetLanguageFilter = "all" | "en" | "ja";

export type SetListLike = {
  groupId: number;
  name: string;
  abbreviation: string | null;
  language: "en" | "ja";
  /** YYYY-MM-DD or null. */
  publishedOn: string | null;
  pricedCount: number;
  totalCents: number;
  top20Cents: number;
  changePct: number | null;
  yourItems: number;
};

export type SetListQuery = {
  language: SetLanguageFilter;
  text: string;
  sort: SetSort;
  /** Hide sets with no priced cards (mostly very old or odd sets). */
  onlyPriced: boolean;
  /** Only sets where you hold something linked to the catalogue. */
  onlyMine: boolean;
};

export const DEFAULT_SET_QUERY: SetListQuery = {
  language: "all",
  text: "",
  sort: "newest",
  onlyPriced: true,
  onlyMine: false,
};

export const SORT_LABELS: Record<SetSort, string> = {
  newest: "Newest first",
  value: "Set value",
  top20: "Top 20 value",
  change: "Change this month",
  name: "Name A–Z",
};

/** Biggest first, with unknowns (null) always last whichever way it sorts. */
function desc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

export function filterAndSortSets<T extends SetListLike>(
  rows: ReadonlyArray<T>,
  q: SetListQuery,
): T[] {
  const term = q.text.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (q.language !== "all" && r.language !== q.language) return false;
    if (q.onlyPriced && r.pricedCount === 0) return false;
    if (q.onlyMine && r.yourItems === 0) return false;
    if (term) {
      const hay = `${r.name} ${r.abbreviation ?? ""}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
  out.sort((a, b) => {
    let c = 0;
    switch (q.sort) {
      case "newest":
        // ISO dates sort as text. Undated sets go to the end.
        c =
          a.publishedOn == null && b.publishedOn == null
            ? 0
            : a.publishedOn == null
              ? 1
              : b.publishedOn == null
                ? -1
                : b.publishedOn.localeCompare(a.publishedOn);
        break;
      case "value":
        c = desc(a.totalCents, b.totalCents);
        break;
      case "top20":
        c = desc(a.top20Cents, b.top20Cents);
        break;
      case "change":
        c = desc(a.changePct, b.changePct);
        break;
      case "name":
        c = a.name.localeCompare(b.name);
        break;
    }
    // A stable, repeatable order for ties.
    return c || a.name.localeCompare(b.name) || a.groupId - b.groupId;
  });
  return out;
}

/** "Jan 2025", or "—" when the set has no known release date. */
export function releaseLabel(publishedOn: string | null): string {
  if (!publishedOn) return "—";
  const m = /^(\d{4})-(\d{2})/.exec(publishedOn);
  if (!m) return "—";
  const months = [
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
  ];
  const month = months[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : "—";
}

/** "+12.3%" / "−4.0%", or "—" before there is a month of history. */
export function changeLabel(pct: number | null): string {
  if (pct == null) return "—";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct * 100).toFixed(1)}%`;
}

/**
 * TCGplayer stamps some old sets (POP Series, promo buckets...) with one
 * recent bulk date, so their "published" day is when they were last touched,
 * not when they came out. Real releases rarely share a day with many others,
 * so a date carried by this many sets is treated as unknown.
 */
export const BULK_DATE_THRESHOLD = 10;

/** The dates (YYYY-MM-DD) that too many sets share to be real release dates. */
export function bulkReleaseDates(
  dates: ReadonlyArray<string | null>,
  threshold = BULK_DATE_THRESHOLD,
): Set<string> {
  const counts = new Map<string, number>();
  for (const d of dates) if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([d]) => d));
}

/** The share of today's priced cards that had to be priced already. */
export const COMPARABLE_COVERAGE = 0.9;

/**
 * Change in a set's value since an earlier day, or null when the two days
 * aren't comparable.
 *
 * A set's total grows when cards gain a price, not only when prices move. If
 * far fewer cards were priced back then, "+20,000%" is a coverage change
 * rather than a market move. So a change is only reported when at least 90%
 * of today's priced cards were already priced on the earlier day. A missing
 * or zero starting value also gives null.
 */
export function comparableChange(input: {
  totalCents: number;
  pricedCount: number;
  priorTotalCents: number | null;
  priorPricedCount: number | null;
}): number | null {
  const { totalCents, pricedCount, priorTotalCents, priorPricedCount } = input;
  if (priorTotalCents == null || priorPricedCount == null) return null;
  if (priorTotalCents <= 0 || pricedCount <= 0) return null;
  if (priorPricedCount < pricedCount * COMPARABLE_COVERAGE) return null;
  return totalCents / priorTotalCents - 1;
}
