"use server";

import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { items, transactions } from "@/db/schema";
import {
  InsufficientHoldingsError,
  MixedCurrencyError,
  computeHoldings,
} from "@/lib/calc/holdings";
import { storedExitReason } from "@/lib/calc/exit_reason";
import type { ActionResult } from "./items";

const schema = z.object({
  shortfalls: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        missing: z.number().int().positive(),
        expectedHeld: z.number().int().positive(),
      }),
    )
    .min(1, "Nothing to record.")
    .max(500, "Record at most 500 items at once."),
});

/**
 * Book what a count found missing as units lost: a ₫0 sale with the "lost"
 * reason, dated now, so the ledger comes down to the shelf while cost basis
 * and profit stay consistent with every other write-off.
 *
 * Each item is checked against the figure the person counted against; if the
 * ledger has moved since (a sale or a delivery in between) nothing is
 * recorded and the message says which item to recount. All-or-nothing.
 */
export async function recordCountShortfalls(
  input: z.input<typeof schema>,
): Promise<ActionResult<{ count: number; units: number }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const { shortfalls } = parsed.data;
  if (new Set(shortfalls.map((s) => s.itemId)).size !== shortfalls.length) {
    return { ok: false, error: "An item appears twice." };
  }

  const ids = shortfalls.map((s) => s.itemId);
  const [named, txs] = await Promise.all([
    db
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(inArray(items.id, ids)),
    db.select().from(transactions).where(inArray(transactions.itemId, ids)),
  ]);
  const nameOf = new Map(named.map((n) => [n.id, n.name]));
  const now = new Date();
  const day = now.toLocaleDateString("en-CA");

  const inserts: (typeof transactions.$inferInsert)[] = [];
  for (const s of shortfalls) {
    const name = nameOf.get(s.itemId);
    if (!name) return { ok: false, error: "An item no longer exists." };
    const own = txs.filter((t) => t.itemId === s.itemId);
    let held: number;
    let currency: string;
    try {
      const snap = computeHoldings(own);
      held = snap.quantity;
      currency = snap.currency;
    } catch (err) {
      if (err instanceof MixedCurrencyError) {
        return { ok: false, error: `${name}: ${err.message}` };
      }
      throw err;
    }
    if (held !== s.expectedHeld) {
      return {
        ok: false,
        error: `${name}: the ledger changed since you counted (now ${held}, was ${s.expectedHeld}). Recount it.`,
      };
    }
    const sell = {
      itemId: s.itemId,
      type: "sell" as const,
      quantity: s.missing,
      finalValueCents: 0,
      shippingCents: null,
      currency,
      occurredAt: now,
      lotId: null,
      status: "received" as const,
    };
    try {
      computeHoldings([...own, sell]);
    } catch (err) {
      if (
        err instanceof InsufficientHoldingsError ||
        err instanceof MixedCurrencyError
      ) {
        return { ok: false, error: `${name}: ${err.message}` };
      }
      throw err;
    }
    inserts.push({
      itemId: s.itemId,
      type: "sell",
      quantity: s.missing,
      finalValueCents: 0,
      currency,
      occurredAt: now,
      note: `Stock count ${day}: ${s.missing} not found on the shelf`,
      status: "received",
      exitReason: storedExitReason("sell", "lost"),
    });
  }

  await db.transaction(async (tx) => {
    for (const row of inserts) await tx.insert(transactions).values(row);
  });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/history");
  revalidatePath("/stock-count");
  for (const id of ids) revalidatePath(`/items/${id}`);
  return {
    ok: true,
    data: {
      count: inserts.length,
      units: inserts.reduce((n, r) => n + r.quantity, 0),
    },
  };
}
