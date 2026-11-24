"use server";

import { revalidatePath } from "next/cache";
import { desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  deletedTransactions,
  items,
  transactions,
  type Transaction,
} from "@/db/schema";
import {
  InsufficientHoldingsError,
  MixedCurrencyError,
  computeHoldings,
} from "@/lib/calc/holdings";
import {
  isSupportedCurrency,
  parseAmountLoose,
  DEFAULT_TRANSACTION_CURRENCY,
} from "@/lib/currency";
import { storedExitReason } from "@/lib/calc/exit_reason";
import { checkDateMoves } from "@/lib/calc/bulk_date";
import { daysLeft, purgeBefore } from "@/lib/calc/recently_deleted";
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
  /** Sells only: 'gifted' | 'lost' | 'opened'. Anything else = a sale. */
  exitReason: z.string().optional().nullable(),
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
    finalValueCents = parseAmountLoose(parsed.data.finalValue, currency);
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
      shippingCents = parseAmountLoose(parsed.data.shipping, currency);
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
      exitReason: storedExitReason(parsed.data.type, parsed.data.exitReason),
    })
    .returning();

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/history");
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
  exitReason: z.string().optional().nullable(),
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
    finalValueCents = parseAmountLoose(
      parsed.data.finalValue,
      existing.currency,
    );
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
      shippingCents = parseAmountLoose(parsed.data.shipping, existing.currency);
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
      exitReason: storedExitReason(parsed.data.type, parsed.data.exitReason),
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
): Promise<ActionResult<Transaction>> {
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

  // Keep a copy for "Recently deleted" in the same database transaction, so
  // a row is never gone without a way back (nor archived but still live).
  await db.transaction(async (dbtx) => {
    await dbtx
      .insert(deletedTransactions)
      .values({ id: tx.id, itemId: tx.itemId, snapshot: tx })
      .onConflictDoUpdate({
        target: deletedTransactions.id,
        set: { snapshot: tx, deletedAt: new Date() },
      });
    await dbtx.delete(transactions).where(eq(transactions.id, id));
  });
  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/history");
  revalidatePath(`/items/${tx.itemId}`);
  return { ok: true, data: tx };
}

/**
 * One row in a bulk paste. `itemId` is optional — when null the server
 * will create a bare item with the provided `itemName` first.
 */
export type BulkTransactionInput = {
  itemId: string | null;
  itemName: string;
  type: "buy" | "sell";
  quantity: number;
  finalValue: string;
  currency: string;
  occurredAt: string;
};

export type BulkTransactionResult = {
  createdCount: number;
  createdItems: number;
  errors: { row: number; message: string }[];
};

/**
 * Batch-create transactions from the paste modal. Any row with a null
 * `itemId` triggers item creation first. Errors are per-row so a bad
 * line doesn't cancel the good ones.
 */
export async function createTransactionsBulk(
  rows: BulkTransactionInput[],
): Promise<ActionResult<BulkTransactionResult>> {
  const { createItem } = await import("./items");
  const result: BulkTransactionResult = {
    createdCount: 0,
    createdItems: 0,
    errors: [],
  };
  // Cache newly-created item ids by name so duplicate rows in one paste
  // don't create duplicate items.
  const newItemIdByName = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let itemId = row.itemId;
    if (!itemId) {
      const cached = newItemIdByName.get(row.itemName.toLowerCase());
      if (cached) {
        itemId = cached;
      } else {
        const created = await createItem({ name: row.itemName });
        if (!created.ok) {
          result.errors.push({ row: i + 1, message: created.error });
          continue;
        }
        itemId = created.data.id;
        newItemIdByName.set(row.itemName.toLowerCase(), itemId);
        result.createdItems += 1;
      }
    }
    const res = await createTransaction({
      itemId,
      type: row.type,
      quantity: row.quantity,
      finalValue: row.finalValue,
      currency: row.currency,
      occurredAt: new Date(row.occurredAt),
    });
    if (!res.ok) {
      result.errors.push({ row: i + 1, message: res.error });
      continue;
    }
    result.createdCount += 1;
  }

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/items");
  return { ok: true, data: result };
}

/**
 * Put a transaction back. The history is replayed with it included first, so
 * a restore can never leave an item with an impossible timeline (for example
 * restoring a buy whose currency no longer matches, or a sell with no stock
 * left to cover it). The archive entry is removed in the same step.
 */
const rescheduleSchema = z.object({
  moves: z
    .array(
      z.object({
        id: z.string().uuid(),
        occurredAt: z.coerce.date(),
      }),
    )
    .min(1, "Nothing selected.")
    .max(1000, "Move at most 1000 transactions at once."),
});

/**
 * Move several transactions to new dates in one go. Each item's whole
 * timeline is replayed with the new dates first; if any would no longer add
 * up (a sale ahead of its purchase), nothing moves and the message names the
 * item. Amounts, quantities and everything else are untouched.
 */
export async function rescheduleTransactions(
  input: z.input<typeof rescheduleSchema>,
): Promise<ActionResult<{ count: number }>> {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const { moves } = parsed.data;

  const picked = await db
    .select({ id: transactions.id, itemId: transactions.itemId })
    .from(transactions)
    .where(
      inArray(
        transactions.id,
        moves.map((m) => m.id),
      ),
    );
  const itemIds = Array.from(new Set(picked.map((p) => p.itemId)));
  const all = itemIds.length
    ? await db
        .select()
        .from(transactions)
        .where(inArray(transactions.itemId, itemIds))
    : [];
  const names = itemIds.length
    ? await db
        .select({ id: items.id, name: items.name })
        .from(items)
        .where(inArray(items.id, itemIds))
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));

  const check = checkDateMoves(
    all,
    moves,
    (id) => nameById.get(id) ?? "An item",
    new Date(),
  );
  if (!check.ok) return { ok: false, error: check.error };

  await db.transaction(async (tx) => {
    for (const m of moves) {
      await tx
        .update(transactions)
        .set({ occurredAt: m.occurredAt })
        .where(eq(transactions.id, m.id));
    }
  });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/history");
  for (const id of check.affectedItemIds) revalidatePath(`/items/${id}`);
  return { ok: true, data: { count: moves.length } };
}

async function reinsertTransaction(
  tx: Transaction,
): Promise<ActionResult<Transaction>> {
  const [item] = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.id, tx.itemId))
    .limit(1);
  if (!item) {
    return {
      ok: false,
      error: "The item for this transaction no longer exists.",
    };
  }
  const [already] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.id, tx.id))
    .limit(1);
  if (already) {
    await db
      .delete(deletedTransactions)
      .where(eq(deletedTransactions.id, tx.id));
    return { ok: true, data: tx };
  }

  const siblings = await db
    .select()
    .from(transactions)
    .where(eq(transactions.itemId, tx.itemId));
  try {
    computeHoldings([...siblings, tx]);
  } catch (err) {
    if (
      err instanceof InsufficientHoldingsError ||
      err instanceof MixedCurrencyError
    ) {
      return { ok: false, error: `Could not restore: ${err.message}` };
    }
    throw err;
  }

  try {
    await db.transaction(async (dbtx) => {
      await dbtx.insert(transactions).values(tx);
      await dbtx
        .delete(deletedTransactions)
        .where(eq(deletedTransactions.id, tx.id));
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not restore: ${err.message}`
          : "Could not restore transaction",
    };
  }
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/items");
  revalidatePath(`/items/${tx.itemId}`);
  return { ok: true, data: tx };
}

/** Re-insert a transaction right after `deleteTransaction` (Undo toast).
 * A strict clone including the original id. */
export async function restoreTransaction(
  tx: Transaction,
): Promise<ActionResult<Transaction>> {
  return reinsertTransaction({
    ...tx,
    occurredAt: new Date(tx.occurredAt),
    createdAt: new Date(tx.createdAt),
  });
}

export type DeletedTransactionRow = {
  id: string;
  itemId: string;
  itemName: string;
  type: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  currency: string;
  /** ISO strings so the rows cross to the client as plain JSON. */
  occurredAt: string;
  deletedAt: string;
  exitReason: string | null;
  note: string | null;
  daysLeft: number;
};

const snapshotSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  type: z.enum(["buy", "sell"]),
  quantity: z.number().int(),
  finalValueCents: z.number(),
  shippingCents: z.number().nullable(),
  currency: z.string(),
  occurredAt: z.coerce.date(),
  note: z.string().nullable(),
  lotId: z.string().nullable(),
  status: z.enum(["pending", "received"]),
  // Older snapshots predate the column.
  exitReason: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
});

/** Newest first. Expired entries are purged here, so no cron is needed. */
export async function listDeletedTransactions(): Promise<
  DeletedTransactionRow[]
> {
  const now = new Date();
  await db
    .delete(deletedTransactions)
    .where(lt(deletedTransactions.deletedAt, purgeBefore(now)));

  const rows = await db
    .select({
      id: deletedTransactions.id,
      snapshot: deletedTransactions.snapshot,
      deletedAt: deletedTransactions.deletedAt,
      itemName: items.name,
    })
    .from(deletedTransactions)
    .innerJoin(items, eq(deletedTransactions.itemId, items.id))
    .orderBy(desc(deletedTransactions.deletedAt));

  const out: DeletedTransactionRow[] = [];
  for (const r of rows) {
    const snap = snapshotSchema.safeParse(r.snapshot);
    if (!snap.success) continue;
    const s = snap.data;
    out.push({
      id: s.id,
      itemId: s.itemId,
      itemName: r.itemName,
      type: s.type,
      quantity: s.quantity,
      finalValueCents: s.finalValueCents,
      currency: s.currency,
      occurredAt: s.occurredAt.toISOString(),
      deletedAt: r.deletedAt.toISOString(),
      exitReason: s.exitReason ?? null,
      note: s.note,
      daysLeft: daysLeft(r.deletedAt, now),
    });
  }
  return out;
}

/** Restore one entry from "Recently deleted". */
export async function restoreDeletedTransaction(
  id: string,
): Promise<ActionResult<Transaction>> {
  const [row] = await db
    .select()
    .from(deletedTransactions)
    .where(eq(deletedTransactions.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "That entry is no longer available." };
  const snap = snapshotSchema.safeParse(row.snapshot);
  if (!snap.success) {
    return {
      ok: false,
      error: "This entry is damaged and cannot be restored.",
    };
  }
  return reinsertTransaction({
    ...snap.data,
    exitReason: snap.data.exitReason ?? null,
  });
}

/** Remove an entry from "Recently deleted" for good. */
export async function purgeDeletedTransaction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  await db.delete(deletedTransactions).where(eq(deletedTransactions.id, id));
  revalidatePath("/history");
  return { ok: true, data: { id } };
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
      shippingCents = parseAmountLoose(shippingInput, tx.currency);
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
