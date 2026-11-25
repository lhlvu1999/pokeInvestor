"use server";

/**
 * Price floor: per-item "tell me when the market price falls to or below this".
 * Server actions only; the reads live in `price_floor_hits.ts` (a "use server"
 * file may export only async functions, and reads shouldn't be callable from the
 * browser).
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import { MAX_FLOOR_CENTS } from "@/lib/calc/price_floor";
import { isSupportedCurrency, parseAmountLoose } from "@/lib/currency";
import type { ActionResult } from "./items";

/**
 * Set an item's price floor. `amount` is in major units as typed ("2.5m", "30");
 * `currency` is the one the item is priced in. Changing the floor starts the
 * alert fresh.
 */
export async function setPriceFloor(
  itemId: string,
  amount: string,
  currency: string,
): Promise<ActionResult<{ floorCents: number; currency: string }>> {
  const cur = (currency ?? "").toUpperCase();
  if (!isSupportedCurrency(cur)) {
    return { ok: false, error: `Unsupported currency: ${cur || "none"}` };
  }
  let cents: number;
  try {
    cents = parseAmountLoose(amount ?? "", cur);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid floor price" };
  }
  if (!Number.isInteger(cents) || cents <= 0) {
    return { ok: false, error: "The floor must be more than zero." };
  }
  if (cents > MAX_FLOOR_CENTS) return { ok: false, error: "That floor is too large." };
  const [updated] = await db
    .update(items)
    .set({ floorCents: cents, floorCurrency: cur, floorAlertedAt: null })
    .where(eq(items.id, itemId))
    .returning({ id: items.id });
  if (!updated) return { ok: false, error: "Item not found" };
  revalidatePath(`/items/${itemId}`);
  revalidatePath("/");
  return { ok: true, data: { floorCents: cents, currency: cur } };
}

/** Remove an item's price floor (and any "already alerted" mark). */
export async function clearPriceFloor(itemId: string): Promise<ActionResult<null>> {
  const [updated] = await db
    .update(items)
    .set({ floorCents: null, floorCurrency: null, floorAlertedAt: null })
    .where(eq(items.id, itemId))
    .returning({ id: items.id });
  if (!updated) return { ok: false, error: "Item not found" };
  revalidatePath(`/items/${itemId}`);
  revalidatePath("/");
  return { ok: true, data: null };
}
