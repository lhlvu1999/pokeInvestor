/**
 * The dashboard's "Needs attention" queue.
 *
 * The goal is the opposite of a notification feed: each row is something
 * you can act on right now, and the list is EMPTY when nothing needs you,
 * which the UI renders as a calm "all clear" rather than filler.
 *
 * Pure function of already-loaded data so the rules (what counts, in what
 * order, how it reads) are testable without a database.
 */

import { BACKUP_STALE_DAYS } from "./backup";
import { ageInDays, ageInHours, formatAge } from "./relative_time";

export type AttentionTone = "warn" | "info" | "good";

export type AttentionItem = {
  key: string;
  tone: AttentionTone;
  title: string;
  detail: string;
  href: string;
  cta: string;
};

export type AttentionInput = {
  now: Date;
  /** Formats a display-currency minor-unit amount, e.g. "₫34.3M". */
  formatMoney: (minor: number) => string;
  pending: {
    units: number;
    itemCount: number;
    costDisplay: number;
    oldestAt: Date | null;
  } | null;
  unpriced: { count: number; costDisplay: number };
  /** Newest market-price snapshot across held items, null if none exist. */
  latestPriceAt: Date | null;
  sell: { count: number; names: string[] };
  /** Held items whose market price has reached their sell target. */
  sellTargets?: { count: number; names: string[] };
  /** Held items whose market price has fallen to or below their price floor. */
  floorHits?: { count: number; names: string[] };
  watchlist: { count: number; names: string[] };
  /** Entries that look like slips (see calc/data_checks). */
  dataChecks?: { count: number; freeSales: number };
  /** Days since the last backup (null = never), and whether there is anything to lose. */
  backup?: { daysSince: number | null; hasData: boolean };
};

/** An undelivered order older than this is worth chasing. */
export const OVERDUE_DELIVERY_DAYS = 14;
/** Prices older than this are too stale to trust for valuation. */
export const STALE_PRICE_HOURS = 48;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "A, B" / "A, B +3 more" — never lets a long list blow out a row. */
function nameList(names: string[], total: number, show = 2): string {
  const shown = names.slice(0, show).join(", ");
  const extra = total - Math.min(names.length, show);
  return extra > 0 ? `${shown} +${extra} more` : shown;
}

export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const {
    now,
    formatMoney,
    pending,
    unpriced,
    latestPriceAt,
    sell,
    sellTargets,
    floorHits,
    watchlist,
    dataChecks,
    backup,
  } = input;
  const items: AttentionItem[] = [];

  // 1. Goods you've paid for but don't have. Money is out the door, and
  //    an old order is the one thing here that can quietly go wrong.
  if (pending && pending.units > 0) {
    const oldestDays = pending.oldestAt
      ? Math.floor(ageInDays(pending.oldestAt, now))
      : null;
    const overdue = oldestDays != null && oldestDays >= OVERDUE_DELIVERY_DAYS;
    const parts = [
      `${pending.itemCount} ${plural(pending.itemCount, "item", "items")}`,
      `${formatMoney(pending.costDisplay)} paid`,
    ];
    if (oldestDays != null) parts.push(`oldest bought ${oldestDays}d ago`);
    items.push({
      key: "on-the-way",
      tone: overdue ? "warn" : "info",
      title: `${pending.units} ${plural(pending.units, "unit", "units")} on the way`,
      detail: parts.join(" · "),
      href: "/items?status=on-the-way",
      cta: "View",
    });
  }

  // 2. Stale prices poison every valuation figure on the page, so call
  //    it out before the gaps in coverage.
  if (latestPriceAt && ageInHours(latestPriceAt, now) >= STALE_PRICE_HOURS) {
    items.push({
      key: "stale-prices",
      tone: "warn",
      title: `Prices last updated ${formatAge(latestPriceAt, now)}`,
      detail: "Portfolio value and price moves may be out of date",
      href: "/items",
      cta: "Update prices",
    });
  }

  // 3. Held items we can't value at all.
  if (unpriced.count > 0) {
    items.push({
      key: "unpriced",
      tone: "warn",
      title: `${unpriced.count} held ${plural(unpriced.count, "item has", "items have")} no market price`,
      detail: `${formatMoney(unpriced.costDisplay)} of cost isn't reflected in your value`,
      href: "/items",
      cta: "Update prices",
    });
  }

  // 3a. A price you said you wanted to hear about has been reached. It comes
  //     with the price problems because it is about the same thing: what your
  //     stock is worth right now. A heads-up about your own threshold, nothing more.
  if (floorHits && floorHits.count > 0) {
    items.push({
      key: "price-floors",
      tone: "warn",
      title: `${floorHits.count} ${plural(floorHits.count, "item has", "items have")} fallen to your price floor`,
      detail: nameList(floorHits.names, floorHits.count),
      href: "/items",
      cta: "Review",
    });
  }

  // 3b. Entries that look like slips quietly skew win rate and margin.
  if (dataChecks && dataChecks.count > 0) {
    items.push({
      key: "data-checks",
      tone: "info",
      title: `${dataChecks.count} ${plural(dataChecks.count, "entry", "entries")} worth a second look`,
      detail:
        dataChecks.freeSales > 0
          ? `${dataChecks.freeSales} ${plural(dataChecks.freeSales, "sale", "sales")} for nothing, not marked as gifted or lost`
          : "Possible slips in the dates or prices you logged",
      href: "/analytics/annual#check",
      cta: "Review",
    });
  }

  // 3c. Everything lives in one database; a copy elsewhere is the only safety net.
  if (
    backup?.hasData &&
    (backup.daysSince === null || backup.daysSince >= BACKUP_STALE_DAYS)
  ) {
    items.push({
      key: "backup",
      tone: "info",
      title:
        backup.daysSince === null
          ? "No backup of your data yet"
          : `Last backup was ${backup.daysSince} days ago`,
      detail: "Everything is stored in one database on this machine",
      href: "/settings#backup",
      cta: "Back up",
    });
  }

  // 4a. A price you set yourself has been reached. It is good news and
  //     something you can act on today, so it comes before the softer
  //     "worth a look" sentiment signals.
  if (sellTargets && sellTargets.count > 0) {
    items.push({
      key: "sell-targets",
      tone: "good",
      title: `${sellTargets.count} ${plural(sellTargets.count, "item has", "items have")} reached your sell target`,
      detail: nameList(sellTargets.names, sellTargets.count),
      href: "/offer",
      cta: "Offer",
    });
  }

  // 4. Sell signals — a prompt to look, never an instruction to sell.
  if (sell.count > 0) {
    items.push({
      key: "sell",
      tone: "info",
      title: `${sell.count} ${plural(sell.count, "item", "items")} worth a look to sell`,
      detail: nameList(sell.names, sell.count),
      href: "/insights",
      cta: "Review",
    });
  }

  // 5. The one piece of good news in the queue.
  if (watchlist.count > 0) {
    items.push({
      key: "watchlist",
      tone: "good",
      title: `${watchlist.count} watchlist ${plural(watchlist.count, "item", "items")} turning bullish`,
      detail: nameList(watchlist.names, watchlist.count),
      href: "/watchlist",
      cta: "Open",
    });
  }

  return items;
}
