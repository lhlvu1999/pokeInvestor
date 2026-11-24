"use server";

/**
 * Sell target: per-item "tell me when the market price reaches this".
 * Server actions only; the reads live in `sell_target_hits.ts` (a "use server"
 * file may export only async functions, and reads shouldn't be callable from
 * the browser).
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import { isSupportedCurrency, parseAmountLoose } from "@/lib/currency";
import type { ActionResult } from "./items";

/**
 * Set an item's sell target. `amount` is in major units as typed ("2.5m",
 * "30"); `currency` is the one the item is priced in. Changing the target
 * starts the alert fresh.
 */
export async function setSellTarget(
  itemId: string,
  amount: string,
  currency: string,
): Promise<ActionResult<{ targetCents: number; currency: string }>> {
  const cur = (currency ?? "").toUpperCase();
  if (!isSupportedCurrency(cur)) {
    return { ok: false, error: `Unsupported currency: ${cur || "none"}` };
  }
  let cents: number;
  try {
    cents = parseAmountLoose(amount ?? "", cur);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid target price",
    };
  }
  if (!Number.isInteger(cents) || cents <= 0) {
    return { ok: false, error: "The target must be more than zero." };
  }
  // A 32-bit column: refuse what wouldn't fit rather than overflow.
  if (cents > 2_000_000_000) {
    return { ok: false, error: "That target is too large." };
  }
  const [updated] = await db
    .update(items)
    .set({
      sellTargetCents: cents,
      sellTargetCurrency: cur,
      sellTargetAlertedAt: null,
    })
    .where(eq(items.id, itemId))
    .returning({ id: items.id });
  if (!updated) return { ok: false, error: "Item not found" };
  revalidatePath(`/items/${itemId}`);
  revalidatePath("/");
  return { ok: true, data: { targetCents: cents, currency: cur } };
}

/** Remove an item's sell target (and any "already alerted" mark). */
export async function clearSellTarget(
  itemId: string,
): Promise<ActionResult<null>> {
  const [updated] = await db
    .update(items)
    .set({
      sellTargetCents: null,
      sellTargetCurrency: null,
      sellTargetAlertedAt: null,
    })
    .where(eq(items.id, itemId))
    .returning({ id: items.id });
  if (!updated) return { ok: false, error: "Item not found" };
  revalidatePath(`/items/${itemId}`);
  revalidatePath("/");
  return { ok: true, data: null };
}
