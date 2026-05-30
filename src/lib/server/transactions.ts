"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { transactions, type Transaction } from "@/db/schema";
import {
  InsufficientHoldingsError,
  MixedCurrencyError,
  computeHoldings,
} from "@/lib/calc/holdings";
import {
  isSupportedCurrency,
  parseAmount,
  DEFAULT_TRANSACTION_CURRENCY,
} from "@/lib/currency";
import type { ActionResult } from "./items";

const transactionInputSchema = z.object({
  itemId: z.string().uuid(),
  type: z.enum(["buy", "sell"]),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be at least 1"),
  finalValue: z.string().min(1, "Final value is required"),
  /** Optional. Portion of finalValue that is shipping (for analytics). */
  shipping: z.string().optional().or(z.literal("")),
  /** Defaults to 'received' (in hand). 'pending' for paid-but-not-yet-arrived. */
  status: z.enum(["pending", "received"]).optional(),
  currency: z.string().length(3),
  occurredAt: z.coerce.date(),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CreateTransactionInput = z.input<typeof transactionInputSchema>;

export async function createTransaction(
  input: CreateTransactionInput,
): Promise<ActionResult<Transaction>> {
  const parsed = transactionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const currency = parsed.data.currency.toUpperCase();
  if (!isSupportedCurrency(currency)) {
    return { ok: false, error: `Unsupported currency: ${currency}` };
  }

  let finalValueCents: number;
  try {
    finalValueCents = parseAmount(parsed.data.finalValue, currency);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid final value",
    };
  }
  if (finalValueCents < 0) {
    return { ok: false, error: "Final value cannot be negative" };
  }

  let shippingCents: number | null = null;
  if (parsed.data.shipping && parsed.data.shipping.trim() !== "") {
    try {
      shippingCents = parseAmount(parsed.data.shipping, currency);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid shipping value",
      };
    }
    if (shippingCents < 0) {
      return { ok: false, error: "Shipping cannot be negative" };
    }
    if (shippingCents > finalValueCents) {
      return {
        ok: false,
        error: "Shipping cannot exceed the total final value.",
      };
    }
  }

  // Sells are always immediately fulfilled; status only matters for buys.
  const status: "pending" | "received" =
    parsed.data.type === "sell"
      ? "received"
      : (parsed.data.status ?? "received");

  const existing = await db
    .select()
    .from(transactions)
    .where(eq(transactions.itemId, parsed.data.itemId));

  const candidate = [
    ...existing,
    {
      type: parsed.data.type,
      quantity: parsed.data.quantity,
      finalValueCents,
      shippingCents,
      occurredAt: parsed.data.occurredAt,
      currency,
      lotId: null,
      status,
    },
  ];

  try {
    computeHoldings(candidate);
  } catch (err) {
    if (err instanceof InsufficientHoldingsError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof MixedCurrencyError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const [created] = await db
    .insert(transactions)
    .values({
      itemId: parsed.data.itemId,
      type: parsed.data.type,
      quantity: parsed.data.quantity,
      finalValueCents,
      shippingCents,
      currency,
      occurredAt: parsed.data.occurredAt,
      note:
        parsed.data.note && parsed.data.note.length > 0
          ? parsed.data.note
          : null,
      status,
    })
    .returning();

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${parsed.data.itemId}`);
  return { ok: true, data: created };
}

const updateInputSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["buy", "sell"]),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be at least 1"),
  finalValue: z.string().min(1, "Final value is required"),
  shipping: z.string().optional().or(z.literal("")),
  status: z.enum(["pending", "received"]).optional(),
  occurredAt: z.coerce.date(),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type UpdateTransactionInput = z.input<typeof updateInputSchema>;

/**
 * Update a transaction's mutable fields. Currency is intentionally read-only —
 * to change currency, delete and recreate. lotId is preserved (identity).
 * Validation: replay all transactions of the same item with the proposed
 * edit applied; reject if the timeline becomes invalid.
 */
export async function updateTransaction(
  input: UpdateTransactionInput,
): Promise<ActionResult<Transaction>> {
  const parsed = updateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }

  const [existing] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, parsed.data.id))
    .limit(1);
  if (!existing) return { ok: false, error: "Transaction not found" };

  let finalValueCents: number;
  try {
    finalValueCents = parseAmount(parsed.data.finalValue, existing.currency);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid final value",
    };
  }
  if (finalValueCents < 0) {
    return { ok: false, error: "Final value cannot be negative" };
  }

  let shippingCents: number | null = null;
  if (parsed.data.shipping && parsed.data.shipping.trim() !== "") {
    try {
      shippingCents = parseAmount(parsed.data.shipping, existing.currency);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid shipping value",
      };
    }
    if (shippingCents < 0) {
      return { ok: false, error: "Shipping cannot be negative" };
    }
    if (shippingCents > finalValueCents) {
      return {
        ok: false,
        error: "Shipping cannot exceed the total final value.",
      };
    }
  }

  // Sells are always received; status only applies to buys.
  const status: "pending" | "received" =
    parsed.data.type === "sell"
      ? "received"
      : (parsed.data.status ?? existing.status);

  const others = await db
    .select()
    .from(transactions)
    .where(eq(transactions.itemId, existing.itemId));
  const candidate = others.map((t) =>
    t.id === parsed.data.id
      ? {
          ...t,
          type: parsed.data.type,
          quantity: parsed.data.quantity,
          finalValueCents,
          shippingCents,
          occurredAt: parsed.data.occurredAt,
          status,
        }
      : t,
  );

  try {
    computeHoldings(candidate);
  } catch (err) {
    if (err instanceof InsufficientHoldingsError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof MixedCurrencyError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const [updated] = await db
    .update(transactions)
    .set({
      type: parsed.data.type,
      quantity: parsed.data.quantity,
      finalValueCents,
      shippingCents,
      occurredAt: parsed.data.occurredAt,
      status,
      note:
        parsed.data.note && parsed.data.note.length > 0
          ? parsed.data.note
          : null,
    })
    .where(eq(transactions.id, parsed.data.id))
    .returning();

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/history");
  revalidatePath(`/items/${existing.itemId}`);
  return { ok: true, data: updated };
}

export async function deleteTransaction(
  id: string,
): Promise<ActionResult<null>> {
  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!tx) return { ok: false, error: "Transaction not found" };

  const remaining = await db
    .select()
    .from(transactions)
    .where(eq(transactions.itemId, tx.itemId));
  const after = remaining.filter((r) => r.id !== id);

  try {
    computeHoldings(after);
  } catch (err) {
    if (err instanceof InsufficientHoldingsError) {
      return {
        ok: false,
        error:
          "Cannot delete this transaction: a later sell would exceed available holdings.",
      };
    }
    throw err;
  }

  await db.delete(transactions).where(eq(transactions.id, id));
  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${tx.itemId}`);
  return { ok: true, data: null };
}

/**
 * Returns the currency of the most-recent transaction for the item, or
 * the global default if none exist yet. Used to pre-fill the form.
 */
export async function getDefaultCurrencyForItem(
  itemId: string,
): Promise<string> {
  const [latest] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.itemId, itemId))
    .orderBy(transactions.occurredAt)
    .limit(1);
  return latest?.currency ?? DEFAULT_TRANSACTION_CURRENCY;
}

/**
 * Set the shipping portion of an existing transaction's total. Keeps the
 * total (finalValueCents) unchanged — only records what part of it was
 * shipping. Pass an empty string to clear the shipping breakdown.
 */
export async function setTransactionShipping(
  id: string,
  shippingInput: string,
): Promise<ActionResult<Transaction>> {
  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!tx) return { ok: false, error: "Transaction not found" };

  let shippingCents: number | null = null;
  if (shippingInput.trim() !== "") {
    try {
      shippingCents = parseAmount(shippingInput, tx.currency);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid shipping value",
      };
    }
    if (shippingCents < 0) {
      return { ok: false, error: "Shipping cannot be negative" };
    }
    if (shippingCents > tx.finalValueCents) {
      return {
        ok: false,
        error: "Shipping cannot exceed the total.",
      };
    }
  }

  const [updated] = await db
    .update(transactions)
    .set({ shippingCents })
    .where(eq(transactions.id, id))
    .returning();
  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${tx.itemId}`);
  revalidatePath("/history");
  return { ok: true, data: updated };
}

/**
 * Flip a pending buy to received. No-op if already received. Doesn't change
 * holdings semantics for anything else.
 */
export async function markTransactionReceived(
  id: string,
): Promise<ActionResult<Transaction>> {
  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!tx) return { ok: false, error: "Transaction not found" };
  if (tx.type !== "buy") {
    return { ok: false, error: "Only buys can be marked received." };
  }
  if (tx.status === "received") {
    return { ok: true, data: tx };
  }

  // Validate: marking received adds inventory at tx.occurredAt — should be
  // safe, but a later sell that previously failed could now consume it. Replay
  // with the change applied; rejects only if the new state is invalid (rare).
  const siblings = await db
    .select()
    .from(transactions)
    .where(eq(transactions.itemId, tx.itemId));
  const candidate = siblings.map((s) =>
    s.id === id ? { ...s, status: "received" as const } : s,
  );
  try {
    computeHoldings(candidate);
  } catch (err) {
    if (err instanceof InsufficientHoldingsError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof MixedCurrencyError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const [updated] = await db
    .update(transactions)
    .set({ status: "received" })
    .where(eq(transactions.id, id))
    .returning();
  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${tx.itemId}`);
  revalidatePath("/history");
  return { ok: true, data: updated };
}
