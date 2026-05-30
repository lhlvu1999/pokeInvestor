"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
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
  parseAmount,
  type CurrencyCode,
} from "@/lib/currency";
import { fetchProduct, pickBestPriceCents } from "@/lib/pricecharting";
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
    priceCents = parseAmount(parsed.data.price, currency);
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
export async function refreshPriceFromPriceCharting(
  itemId: string,
): Promise<
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
