"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import {
  DEFAULT_DISPLAY_CURRENCY,
  isSupportedCurrency,
  type CurrencyCode,
} from "@/lib/currency";
import {
  DEFAULT_COST_METHOD,
  isCostMethod,
  type CostMethod,
} from "@/lib/calc/holdings";
import type { ActionResult } from "./items";

const DISPLAY_CURRENCY_KEY = "display_currency";
const PRICECHARTING_TOKEN_KEY = "pricecharting_token";
const COST_METHOD_KEY = "cost_method";

/**
 * Cached per server-request — when several server components on the same
 * page all need the display currency, the DB query runs once.
 */
const getDisplayCurrencyImpl = cache(async (): Promise<CurrencyCode> => {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, DISPLAY_CURRENCY_KEY))
    .limit(1);
  if (row && isSupportedCurrency(row.value)) return row.value;
  return DEFAULT_DISPLAY_CURRENCY;
});

export async function getDisplayCurrency(): Promise<CurrencyCode> {
  return getDisplayCurrencyImpl();
}

export async function setDisplayCurrency(
  code: string,
): Promise<ActionResult<CurrencyCode>> {
  if (!isSupportedCurrency(code)) {
    return { ok: false, error: `Unsupported currency: ${code}` };
  }
  await db
    .insert(appSettings)
    .values({ key: DISPLAY_CURRENCY_KEY, value: code })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: code, updatedAt: sql`now()` },
    });
  revalidatePath("/", "layout");
  return { ok: true, data: code };
}

export async function getPriceChartingToken(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, PRICECHARTING_TOKEN_KEY))
    .limit(1);
  return row?.value && row.value.length > 0 ? row.value : null;
}

export async function setPriceChartingToken(
  token: string,
): Promise<ActionResult<null>> {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    await db
      .delete(appSettings)
      .where(eq(appSettings.key, PRICECHARTING_TOKEN_KEY));
  } else {
    await db
      .insert(appSettings)
      .values({ key: PRICECHARTING_TOKEN_KEY, value: trimmed })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: trimmed, updatedAt: sql`now()` },
      });
  }
  revalidatePath("/settings");
  return { ok: true, data: null };
}

/**
 * How sells are matched to purchases when computing realized profit and
 * remaining cost basis. Cached per request — most pages need it several
 * times (holdings, cashflow, value chart).
 */
const getCostMethodImpl = cache(async (): Promise<CostMethod> => {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, COST_METHOD_KEY))
    .limit(1);
  return row && isCostMethod(row.value) ? row.value : DEFAULT_COST_METHOD;
});

export async function getCostMethod(): Promise<CostMethod> {
  return getCostMethodImpl();
}

export async function setCostMethod(
  method: string,
): Promise<ActionResult<CostMethod>> {
  if (!isCostMethod(method)) {
    return { ok: false, error: `Unknown cost method: ${method}` };
  }
  await db
    .insert(appSettings)
    .values({ key: COST_METHOD_KEY, value: method })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: method, updatedAt: sql`now()` },
    });
  // Every figure that involves realized profit or cost basis changes.
  revalidatePath("/", "layout");
  return { ok: true, data: method };
}
