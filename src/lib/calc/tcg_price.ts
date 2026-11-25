/**
 * Which items are priced from TCGplayer, and when to write a fresh price.
 *
 * TCGplayer's market price follows what the product actually sold for recently;
 * an eBay estimate is only what sellers are asking. So an item linked to a sealed
 * catalogue product takes its price from the catalogue, and eBay is used for what
 * the catalogue cannot price (graded slabs, unlinked items, products with no
 * recent price).
 */

/** A catalogue price older than this no longer counts (the daily sync has stopped). */
export const MAX_CATALOG_PRICE_AGE_DAYS = 7;

/** A TCGplayer price written less than this long ago is not written again. */
export const TCG_REWRITE_AFTER_MS = 12 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The catalogue's market price in US cents if it can price this item today:
 * linked, positive, recent enough, and the item has a currency to price it in
 * (it has at least one transaction). Null means: use eBay.
 */
export function usableCatalogUsdCents(input: {
  marketCents: number | null;
  day: Date | null;
  now: Date;
  itemCurrency: string | null;
}): number | null {
  const { marketCents, day, now, itemCurrency } = input;
  if (!itemCurrency) return null;
  if (marketCents == null || !Number.isFinite(marketCents) || marketCents <= 0) return null;
  if (!day) return null;
  const age = now.getTime() - day.getTime();
  if (age > MAX_CATALOG_PRICE_AGE_DAYS * DAY_MS) return null;
  return Math.round(marketCents);
}

/**
 * Write a TCGplayer price unless the item's newest price already is one from the
 * last few hours (exchange rates move a little every day, so without this every
 * refresh would add a row that differs by a few dong). A newer eBay or manual row
 * does not block it: the catalogue price wins again at the next refresh.
 */
export function needsTcgWrite(
  newest: { source: string; fetchedAt: Date } | null,
  now: Date,
): boolean {
  if (!newest) return true;
  if (newest.source !== "tcgplayer") return true;
  return now.getTime() - newest.fetchedAt.getTime() >= TCG_REWRITE_AFTER_MS;
}
