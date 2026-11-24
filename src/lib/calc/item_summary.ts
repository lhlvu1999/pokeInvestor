/**
 * A few plain sentences about one item, built only from numbers the app
 * already has. No guessing and no advice: every sentence is a restatement of
 * a figure shown elsewhere on the page, in words, so someone who doesn't
 * read tables can still see where they stand.
 *
 * Sentences come back in groups (position, value, results) so the page can
 * set each group as a short paragraph. A sentence is left out, not softened,
 * when the number behind it doesn't exist (no price, no sales, no mentions).
 */

/** A price older than this is called out as stale. */
export const STALE_PRICE_DAYS = 3;
/** Week-on-week moves smaller than this are noise, not news. */
const MIN_MOVE = 0.005;

export type ItemSummaryInput = {
  held: number;
  /** Paid for but not yet received. */
  pending: number;
  /** Units ever bought (pending included). */
  boughtUnits: number;
  /** Units that left, whatever the reason (sales plus gifts/losses/opened). */
  soldUnits: number;
  /** Of `soldUnits`, those that were gifted, lost or opened (booked as ₫0). */
  exitUnits: number;
  /** Per held unit, minor units of the item's currency. */
  avgCost: number;
  inventoryCost: number;
  /** Null when the item has never been priced. */
  marketPrice: number | null;
  /** Age of that price in days, or null when there is none. */
  priceAgeDays: number | null;
  /** Price change over the last week as a fraction, if it can be measured. */
  weekChangePct: number | null;
  realized: number;
  unrealized: number;
  /** Creator mentions, if the pipeline has any for this item. */
  mentions: {
    total: number;
    bullish: number;
    bearish: number;
    channels: number;
  } | null;
  /** Formats a minor-unit amount in the item's currency. */
  money: (minor: number) => string;
};

export type SummaryLine = {
  /** 0 position, 1 value, 2 results. */
  group: 0 | 1 | 2;
  text: string;
  /** Worth a second look (a stale or missing price). */
  warn?: boolean;
};

function units(n: number): string {
  return `${n} ${n === 1 ? "unit" : "units"}`;
}

function pct(f: number): string {
  return `${(Math.abs(f) * 100).toFixed(1)}%`;
}

export function summarizeItem(i: ItemSummaryInput): SummaryLine[] {
  const out: SummaryLine[] = [];
  const salesUnits = Math.max(0, i.soldUnits - i.exitUnits);

  // ── Position ──────────────────────────────────────────────────────
  if (i.held > 0) {
    out.push({
      group: 0,
      text: `You hold ${units(i.held)}${
        i.pending > 0
          ? ` and ${i.pending} more ${i.pending === 1 ? "is" : "are"} on the way`
          : ""
      }.`,
    });
  } else if (i.pending > 0) {
    out.push({
      group: 0,
      text: `Nothing in hand yet: ${units(i.pending)} ${i.pending === 1 ? "is" : "are"} on the way.`,
    });
  } else if (i.boughtUnits > 0) {
    out.push({ group: 0, text: "You don't hold any of this now." });
  }
  if (i.boughtUnits > 0) {
    const parts: string[] = [`bought ${i.boughtUnits}`];
    if (salesUnits > 0) parts.push(`sold ${salesUnits}`);
    if (i.exitUnits > 0) parts.push(`${i.exitUnits} gifted, lost or opened`);
    out.push({ group: 0, text: `Over time you ${joinList(parts)}.` });
  }
  if (i.held > 0 && i.avgCost > 0) {
    out.push({
      group: 0,
      text: `What you hold cost ${i.money(i.avgCost)} each on average, ${i.money(i.inventoryCost)} in all.`,
    });
  }

  // ── Value ─────────────────────────────────────────────────────────
  if (i.held > 0) {
    if (i.marketPrice == null) {
      out.push({
        group: 1,
        warn: true,
        text: "There's no market price yet, so what it's worth now is unknown.",
      });
    } else {
      const value = i.held * i.marketPrice;
      const diff = value - i.inventoryCost;
      const rel =
        i.inventoryCost > 0 ? ` (${pct(diff / i.inventoryCost)})` : "";
      const verdict =
        diff === 0
          ? "exactly what you paid"
          : `${i.money(Math.abs(diff))}${rel} ${diff > 0 ? "more" : "less"} than you paid`;
      out.push({
        group: 1,
        text: `The market price is ${i.money(i.marketPrice)}, so your ${i.held === 1 ? "unit is" : "units are"} worth about ${i.money(value)}: ${verdict}.`,
      });
      if (i.priceAgeDays != null && i.priceAgeDays >= STALE_PRICE_DAYS) {
        out.push({
          group: 1,
          warn: true,
          text: `That price is ${Math.floor(i.priceAgeDays)} days old; refresh it before relying on it.`,
        });
      }
    }
  }
  if (i.weekChangePct != null && Math.abs(i.weekChangePct) >= MIN_MOVE) {
    out.push({
      group: 1,
      text: `Over the past week the price ${i.weekChangePct > 0 ? "rose" : "fell"} ${pct(i.weekChangePct)} (these are eBay asking prices, so small moves are noise).`,
    });
  }

  // ── Results ───────────────────────────────────────────────────────
  if (i.soldUnits > 0) {
    out.push({
      group: 2,
      text: `From what you've sold, you've ${i.realized >= 0 ? "made" : "lost"} ${i.money(Math.abs(i.realized))}${
        i.exitUnits > 0
          ? `, which includes the ${units(i.exitUnits)} given away, lost or opened (booked as ${i.money(0)})`
          : ""
      }.`,
    });
    const priced = i.held === 0 || i.marketPrice != null;
    if (priced) {
      const total = i.realized + (i.held > 0 ? i.unrealized : 0);
      out.push({
        group: 2,
        text: `All in, you're ${total >= 0 ? "up" : "down"} ${i.money(Math.abs(total))} on this item${
          i.held > 0 ? ", counting what you still hold at its market price" : ""
        }.`,
      });
    }
  }
  if (i.mentions && i.mentions.total > 0) {
    const m = i.mentions;
    const other = m.total - m.bullish - m.bearish;
    out.push({
      group: 2,
      text: `Creators have mentioned it ${m.total} ${m.total === 1 ? "time" : "times"} across ${m.channels} ${m.channels === 1 ? "channel" : "channels"}: ${m.bullish} bullish, ${m.bearish} bearish${other > 0 ? `, ${other} neutral or mixed` : ""}.`,
    });
  }
  return out;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
