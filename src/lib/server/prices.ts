"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  items,
  marketPrices,
  transactions,
  type MarketPrice,
} from "@/db/schema";
import {
  convertMinor,
  isSupportedCurrency,
  parseAmountLoose,
  type CurrencyCode,
} from "@/lib/currency";
import { fetchProduct, pickBestPriceCents } from "@/lib/pricecharting";
import { fetchEbayEstimate } from "@/lib/ebay";
import {
  looksGraded,
  type EstimateConfidence,
} from "@/lib/calc/price_estimate";
import { getRate } from "@/lib/fx";
import { getPriceChartingToken } from "./settings";
import type { ActionResult } from "./items";

const priceInputSchema = z.object({
  itemId: z.string().uuid(),
  price: z.string().min(1),
  currency: z.string().length(3),
});

export type SetManualPriceInput = z.input<typeof priceInputSchema>;

export async function setManualPrice(
  input: SetManualPriceInput,
): Promise<ActionResult<MarketPrice>> {
  const parsed = priceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const currency = parsed.data.currency.toUpperCase();
  if (!isSupportedCurrency(currency)) {
    return { ok: false, error: `Unsupported currency: ${currency}` };
  }

  // Enforce that market price currency matches the item's transaction currency.
  const [existingTx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.itemId, parsed.data.itemId))
    .limit(1);
  if (existingTx && existingTx.currency !== currency) {
    return {
      ok: false,
      error: `Item is tracked in ${existingTx.currency}; price must be in the same currency.`,
    };
  }

  let priceCents: number;
  try {
    priceCents = parseAmountLoose(parsed.data.price, currency);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid price",
    };
  }
  if (priceCents < 0) {
    return { ok: false, error: "Price cannot be negative" };
  }

  const [created] = await db
    .insert(marketPrices)
    .values({
      itemId: parsed.data.itemId,
      priceCents,
      currency,
      source: "manual",
    })
    .returning();

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${parsed.data.itemId}`);
  return { ok: true, data: created };
}

/**
 * Fetch the latest USD market price from PriceCharting for an item that has a
 * `pricechartingId`, convert to the item's tracking currency via FX, and write
 * a new row to `market_prices` with source = 'pricecharting'.
 */
export async function refreshPriceFromPriceCharting(itemId: string): Promise<
  ActionResult<{
    priceCents: number;
    currency: CurrencyCode;
    productName: string;
    rawUsdCents: number;
  }>
> {
  const [item] = await db
    .select()
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  if (!item) return { ok: false, error: "Item not found" };
  if (!item.pricechartingId) {
    return {
      ok: false,
      error: "No PriceCharting product ID set for this item.",
    };
  }

  const token = await getPriceChartingToken();
  if (!token) {
    return {
      ok: false,
      error: "PriceCharting API token not set. Add it on the Settings page.",
    };
  }

  let product;
  try {
    product = await fetchProduct(item.pricechartingId, token);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "PriceCharting fetch failed",
    };
  }

  const usdCents = pickBestPriceCents(product);
  if (usdCents == null) {
    return {
      ok: false,
      error: "PriceCharting did not return a usable price for this product.",
    };
  }

  // Determine the item's tracking currency: existing tx currency wins; else
  // the item's prior market price currency; else default to USD (the API's native).
  const [tx] = await db
    .select({ currency: transactions.currency })
    .from(transactions)
    .where(eq(transactions.itemId, itemId))
    .limit(1);
  const targetCurrency = (tx?.currency ?? "USD") as CurrencyCode;

  let priceInTarget = usdCents;
  if (targetCurrency !== "USD") {
    try {
      const { rate } = await getRate("USD" as CurrencyCode, targetCurrency);
      priceInTarget = convertMinor(usdCents, "USD", targetCurrency, rate);
    } catch (err) {
      return {
        ok: false,
        error:
          "FX conversion failed: " +
          (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  await db.insert(marketPrices).values({
    itemId,
    priceCents: priceInTarget,
    currency: targetCurrency,
    source: "pricecharting",
  });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
  return {
    ok: true,
    data: {
      priceCents: priceInTarget,
      currency: targetCurrency,
      productName: product.productName,
      rawUsdCents: usdCents,
    },
  };
}

/* ------------------------------------------------------------------ */
/* eBay                                                                */
/* ------------------------------------------------------------------ */

export type EbayRefreshResult = {
  priceCents: number;
  currency: CurrencyCode;
  /** Native eBay price before FX conversion. */
  rawMinor: number;
  rawCurrency: string;
  confidence: EstimateConfidence;
  sampleSize: number;
  trimmedCount: number;
  dispersion: number;
  query: string;
  totalMatching: number;
  /** Cheapest kept listings — lets the UI show *what* was priced. */
  samples: { title: string; totalMinor: number; itemWebUrl: string | null }[];
  /** True when nothing was written because confidence was too low. */
  skipped: boolean;
};

/**
 * Price an item from eBay active listings.
 *
 * By default a `low` confidence estimate is NOT persisted — eBay
 * full-text search always returns *something*, so a product whose name
 * searches badly yields a plausible-looking but wrong number, and
 * silently writing that would corrupt portfolio valuation. The caller
 * gets the estimate back either way and can force the write.
 *
 * `newOnly` defaults to true (correct for sealed product). Pass false for
 * graded slabs and second-hand items, where condition NEW excludes the
 * actual market.
 */
export async function refreshPriceFromEbay(
  itemId: string,
  opts: { acceptLowConfidence?: boolean; newOnly?: boolean } = {},
): Promise<ActionResult<EbayRefreshResult>> {
  const [item] = await db
    .select()
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  if (!item) return { ok: false, error: "Item not found" };

  // Graded slabs are never listed as condition NEW, so the default
  // sealed-product filter would return nothing for them. Auto-detect
  // from name/tags unless the caller was explicit.
  const newOnly = opts.newOnly ?? !looksGraded(item.name, item.tags);

  let result;
  try {
    result = await fetchEbayEstimate(item.name, {
      queryOverride: item.ebayQuery,
      newOnly,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "eBay fetch failed",
    };
  }

  if (!result) {
    return {
      ok: false,
      error:
        "Not enough comparable eBay listings to price this item. Try setting a custom eBay search query on the item.",
    };
  }

  const { estimate, currency: rawCurrency, query, totalMatching } = result;
  const samples = result.samples.map((s) => ({
    title: s.title,
    totalMinor: s.totalMinor,
    itemWebUrl: s.itemWebUrl,
  }));

  // Item's tracking currency: existing tx currency wins, else eBay's.
  const [tx] = await db
    .select({ currency: transactions.currency })
    .from(transactions)
    .where(eq(transactions.itemId, itemId))
    .limit(1);
  const targetCurrency = (tx?.currency ?? rawCurrency) as CurrencyCode;

  let priceInTarget = estimate.priceMinor;
  if (targetCurrency !== rawCurrency) {
    try {
      const { rate } = await getRate(
        rawCurrency as CurrencyCode,
        targetCurrency,
      );
      priceInTarget = convertMinor(
        estimate.priceMinor,
        rawCurrency,
        targetCurrency,
        rate,
      );
    } catch (err) {
      return {
        ok: false,
        error:
          "FX conversion failed: " +
          (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  const base: EbayRefreshResult = {
    priceCents: priceInTarget,
    currency: targetCurrency,
    rawMinor: estimate.priceMinor,
    rawCurrency,
    confidence: estimate.confidence,
    sampleSize: estimate.sampleSize,
    trimmedCount: estimate.trimmedCount,
    dispersion: estimate.dispersion,
    query,
    totalMatching,
    samples,
    skipped: false,
  };

  if (estimate.confidence === "low" && !opts.acceptLowConfidence) {
    return { ok: true, data: { ...base, skipped: true } };
  }

  await db.insert(marketPrices).values({
    itemId,
    priceCents: priceInTarget,
    currency: targetCurrency,
    source: "ebay",
  });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
  return { ok: true, data: base };
}

/** Set or clear the per-item eBay search override. */
export async function setEbayQuery(
  itemId: string,
  query: string | null,
): Promise<ActionResult<null>> {
  const trimmed = query?.trim() ?? "";
  await db
    .update(items)
    .set({ ebayQuery: trimmed.length > 0 ? trimmed : null })
    .where(eq(items.id, itemId));
  revalidatePath(`/items/${itemId}`);
  return { ok: true, data: null };
}

/* ------------------------------------------------------------------ */
/* Bulk eBay refresh                                                   */
/* ------------------------------------------------------------------ */

export type BulkPriceOutcome = {
  itemId: string;
  itemName: string;
  status: "saved" | "skipped" | "no_data" | "error" | "cooldown";
  priceCents?: number;
  currency?: string;
  confidence?: EstimateConfidence;
  sampleSize?: number;
  /** Cheapest matched listing — the fastest way to eyeball a bad match. */
  topSampleTitle?: string;
  message?: string;
};

/** Items eligible for a bulk price refresh. */
export type PriceRefreshTarget = { id: string; name: string };

/**
 * How recently an item must have been priced for a bulk run to skip it.
 * Guards the eBay quota against repeated "Update all prices" clicks —
 * asking prices don't move meaningfully inside an hour, so re-fetching
 * is pure waste.
 *
 * Deliberately NOT exported: this is a `"use server"` module, and Next
 * only permits async-function exports from those (a non-function export
 * fails the whole route with "can only export async functions"). The UI
 * doesn't need the raw number — it renders the cooldown from the counts
 * and messages the server returns.
 */
const PRICE_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

export type RefreshTargets = {
  /** Eligible for a bulk run right now. */
  eligible: PriceRefreshTarget[];
  /** Held, but priced within the cooldown window. */
  onCooldown: PriceRefreshTarget[];
};

/** Latest market-price timestamp per item. */
async function latestPricedAtByItem(): Promise<Map<string, Date>> {
  const rows = await db.execute<{ item_id: string; last_at: Date }>(sql`
    SELECT item_id::text AS item_id, MAX(fetched_at) AS last_at
    FROM market_prices
    GROUP BY item_id
  `);
  const out = new Map<string, Date>();
  for (const r of Array.from(rows)) out.set(r.item_id, new Date(r.last_at));
  return out;
}

/**
 * Items for the bulk refresh, split into eligible vs cooling down.
 *
 * `heldOnly` (the default) restricts to items you currently hold —
 * there's no point spending quota pricing something you fully sold.
 */
export async function listPriceRefreshTargets(
  heldOnly = true,
): Promise<RefreshTargets> {
  const rows = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .orderBy(items.name);

  let candidates = rows;
  if (heldOnly) {
    // Held = sum(buy qty) - sum(sell qty) > 0. Computed in SQL to avoid
    // pulling every transaction into JS just to filter a list.
    const held = await db.execute<{ item_id: string }>(sql`
      SELECT item_id::text AS item_id
      FROM transactions
      GROUP BY item_id
      HAVING SUM(CASE WHEN type = 'buy' THEN quantity ELSE -quantity END) > 0
    `);
    const heldIds = new Set(Array.from(held).map((r) => r.item_id));
    candidates = rows.filter((r) => heldIds.has(r.id));
  }

  const lastAt = await latestPricedAtByItem();
  const cutoff = Date.now() - PRICE_REFRESH_COOLDOWN_MS;
  const eligible: PriceRefreshTarget[] = [];
  const onCooldown: PriceRefreshTarget[] = [];
  for (const c of candidates) {
    const at = lastAt.get(c.id);
    if (at && at.getTime() > cutoff) onCooldown.push(c);
    else eligible.push(c);
  }
  return { eligible, onCooldown };
}

/**
 * Refresh a chunk of items from eBay. Called repeatedly by the client
 * with small slices so the UI can show progress and the work stays well
 * inside any single request budget.
 *
 * Chunk members run concurrently — eBay's Browse quota is 5000/day and a
 * full portfolio is ~160 calls, so throughput is the only constraint.
 * Low-confidence estimates are reported but NOT written unless
 * `acceptLowConfidence` is set.
 */
export async function refreshPricesForItems(
  itemIds: string[],
  opts: {
    acceptLowConfidence?: boolean;
    newOnly?: boolean;
    /** Bypass the 1-hour cooldown. Off by default so a stale client (or
     * a double-click) can't burn quota re-pricing what it just fetched. */
    ignoreCooldown?: boolean;
  } = {},
): Promise<ActionResult<BulkPriceOutcome[]>> {
  if (itemIds.length === 0) return { ok: true, data: [] };
  if (itemIds.length > 25) {
    return { ok: false, error: "Refresh at most 25 items per call." };
  }

  const rows = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(inArray(items.id, itemIds));
  const nameById = new Map(rows.map((r) => [r.id, r.name]));

  // Enforced here, not just in the target list: the client sends ids it
  // computed on page load, which may be minutes stale by the time a long
  // run reaches the last chunk.
  const lastAt = opts.ignoreCooldown
    ? new Map<string, Date>()
    : await latestPricedAtByItem();
  const cutoff = Date.now() - PRICE_REFRESH_COOLDOWN_MS;

  const outcomes = await Promise.all(
    itemIds.map(async (itemId): Promise<BulkPriceOutcome> => {
      const itemName = nameById.get(itemId) ?? "(unknown)";
      const priced = lastAt.get(itemId);
      if (priced && priced.getTime() > cutoff) {
        const mins = Math.round(
          (PRICE_REFRESH_COOLDOWN_MS - (Date.now() - priced.getTime())) /
            60_000,
        );
        return {
          itemId,
          itemName,
          status: "cooldown",
          message: `Priced recently — retry in ~${Math.max(1, mins)} min`,
        };
      }
      try {
        const res = await refreshPriceFromEbay(itemId, opts);
        if (!res.ok) {
          // "not enough listings" is an expected outcome, not a failure.
          const noData = res.error.startsWith("Not enough comparable");
          return {
            itemId,
            itemName,
            status: noData ? "no_data" : "error",
            message: res.error,
          };
        }
        const d = res.data;
        return {
          itemId,
          itemName,
          status: d.skipped ? "skipped" : "saved",
          priceCents: d.priceCents,
          currency: d.currency,
          confidence: d.confidence,
          sampleSize: d.sampleSize,
          topSampleTitle: d.samples[0]?.title,
        };
      } catch (err) {
        return {
          itemId,
          itemName,
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/analytics");
  return { ok: true, data: outcomes };
}
