"use server";

import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import {
  InsufficientHoldingsError,
  MixedCurrencyError,
  computeHoldings,
} from "@/lib/calc/holdings";
import type { ActionResult } from "./items";

const lineSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  /** Total received for the line, in minor units of the item's currency. */
  totalMinor: z.number().int().nonnegative(),
});

const inputSchema = z.object({
  lines: z.array(lineSchema).min(1, "Select at least one item").max(200),
  note: z.string().trim().max(500).optional(),
  occurredAt: z.coerce.date().optional(),
});

export type RecordOfferSaleInput = z.input<typeof inputSchema>;

export type RecordOfferSaleResult = {
  count: number;
  totalMinor: number;
};

/**
 * Record every line of an accepted offer as a sell transaction, together.
 *
 * All-or-nothing on purpose: an offer is one deal with one buyer, and a
 * half-recorded sale (some lines in, some out) is worse than none because
 * the books would no longer match what changed hands. So every line is
 * checked against the item's history first, and the inserts run in a single
 * database transaction.
 *
 * The result is ordinary sell transactions, so each can still be edited or
 * deleted from History if the deal changes.
 */
export async function recordOfferSale(
  input: RecordOfferSaleInput,
): Promise<ActionResult<RecordOfferSaleResult>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid offer",
    };
  }
  const { lines, note } = parsed.data;
  const occurredAt = parsed.data.occurredAt ?? new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return { ok: false, error: "Invalid sale date" };
  }

  const ids = lines.map((l) => l.itemId);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "Each item can appear only once in an offer" };
  }

  const existing = await db
    .select()
    .from(transactions)
    .where(inArray(transactions.itemId, ids));
  const byItem = new Map<string, typeof existing>();
  for (const t of existing) {
    const list = byItem.get(t.itemId) ?? [];
    list.push(t);
    byItem.set(t.itemId, list);
  }

  const rows: (typeof transactions.$inferInsert)[] = [];
  for (const l of lines) {
    const history = byItem.get(l.itemId) ?? [];
    if (history.length === 0) {
      return { ok: false, error: "An item on the offer has no history" };
    }
    // An item keeps one currency for life; the sale must match it.
    const currency = history[0].currency;
    const sell = {
      type: "sell" as const,
      quantity: l.quantity,
      finalValueCents: l.totalMinor,
      shippingCents: null,
      occurredAt,
      currency,
      lotId: null,
      status: "received" as const,
    };
    try {
      computeHoldings([...history, sell]);
    } catch (err) {
      if (
        err instanceof InsufficientHoldingsError ||
        err instanceof MixedCurrencyError
      ) {
        return { ok: false, error: err.message };
      }
      throw err;
    }
    rows.push({
      itemId: l.itemId,
      type: "sell",
      quantity: l.quantity,
      finalValueCents: l.totalMinor,
      shippingCents: null,
      currency,
      occurredAt,
      note: note && note.length > 0 ? note : null,
      status: "received",
    });
  }

  await db.transaction(async (tx) => {
    await tx.insert(transactions).values(rows);
  });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/history");
  revalidatePath("/offer");
  for (const id of ids) revalidatePath(`/items/${id}`);

  return {
    ok: true,
    data: {
      count: rows.length,
      totalMinor: lines.reduce((s, l) => s + l.totalMinor, 0),
    },
  };
}
