/**
 * Loader for the "Link items to the catalogue" screen. A pure read (no
 * "use server"); the action that saves links is in `catalog_actions.ts`.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  matchItem,
  prepareCatalog,
  priceSanity,
  type CatalogCandidate,
  type MatchStatus,
} from "@/lib/calc/catalog_match";
import { utcDay } from "@/lib/calc/pg_day";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import { listItemsWithValuations } from "@/lib/server/items";

export type LinkOption = CatalogCandidate & {
  score: number;
  /** "differs" when the catalogue price is nothing like the item's price. */
  sanity: "ok" | "differs" | "unknown";
};

export type LinkRow = {
  itemId: string;
  name: string;
  held: number;
  /** The item's own latest market price, in US cents. */
  itemUsdCents: number | null;
  status: MatchStatus | "linked" | "skipped";
  /** Who linked it: 'auto' (the daily sync) or 'manual', when linked. */
  source: string | null;
  options: LinkOption[];
  /** The product it is linked to now, when linked. */
  linked: CatalogCandidate | null;
};

export type LinkReview = {
  /** False until the first catalogue sync has run. */
  catalogReady: boolean;
  sealedProducts: number;
  /** Day of the newest catalogue price, if any. */
  pricesAsOf: Date | null;
  rows: LinkRow[];
};

import { loadSealedCandidates } from "./catalog_candidates";
export { loadSealedCandidates };

export async function getLinkReview(): Promise<LinkReview> {
  const [candidates, all, latest] = await Promise.all([
    loadSealedCandidates(),
    listItemsWithValuations(),
    db.execute<{ day: Date | null }>(
      sql`SELECT max(day) AS day FROM catalog_prices`,
    ),
  ]);
  const pricesAsOf = utcDay(Array.from(latest)[0]?.day);
  if (candidates.length === 0) {
    return {
      catalogReady: false,
      sealedProducts: 0,
      pricesAsOf: null,
      rows: [],
    };
  }

  const byId = new Map(candidates.map((c) => [c.productId, c]));
  const catalog = prepareCatalog(candidates);

  // Convert each item's own price to USD so it can be set beside TCGplayer's.
  const rates = new Map<string, number>();
  const toUsdCents = async (
    minor: number,
    cur: string,
  ): Promise<number | null> => {
    if (cur === "USD") return minor;
    if (!rates.has(cur)) {
      try {
        rates.set(cur, (await getRate(cur as CurrencyCode, "USD")).rate);
      } catch {
        return null;
      }
    }
    return convertMinor(minor, cur, "USD", rates.get(cur)!);
  };

  const rows: LinkRow[] = [];
  for (const { item, valuation, latestPrice } of all) {
    const held = valuation.quantity;
    const linkedId = item.catalogProductId;
    if (held <= 0 && linkedId == null && !item.catalogLinkSkipped) continue;

    const itemUsdCents = latestPrice
      ? await toUsdCents(latestPrice.priceCents, latestPrice.currency)
      : null;

    if (linkedId != null) {
      rows.push({
        itemId: item.id,
        name: item.name,
        held,
        itemUsdCents,
        status: "linked",
        source: item.catalogLinkSource,
        options: [],
        linked: byId.get(linkedId) ?? null,
      });
      continue;
    }
    if (item.catalogLinkSkipped) {
      rows.push({
        itemId: item.id,
        name: item.name,
        held,
        itemUsdCents,
        status: "skipped",
        source: null,
        options: [],
        linked: null,
      });
      continue;
    }
    const m = matchItem({ name: item.name, tags: item.tags }, catalog);
    rows.push({
      itemId: item.id,
      name: item.name,
      held,
      itemUsdCents,
      status: m.status,
      source: null,
      options: m.options.map((o) => ({
        ...o.candidate,
        score: o.score,
        sanity: priceSanity(
          itemUsdCents == null ? null : itemUsdCents / 100,
          o.candidate.marketCents == null
            ? null
            : o.candidate.marketCents / 100,
        ),
      })),
      linked: null,
    });
  }
  rows.sort((a, b) => b.held - a.held || a.name.localeCompare(b.name));
  return {
    catalogReady: true,
    sealedProducts: candidates.length,
    pricesAsOf,
    rows,
  };
}
