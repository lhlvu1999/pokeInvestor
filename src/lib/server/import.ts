"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { items, transactions } from "@/db/schema";
import { isSupportedCurrency } from "@/lib/currency";
import { itemMatchKey } from "@/lib/import";
import type { ActionResult } from "./items";

const transactionSchema = z.object({
  type: z.enum(["buy", "sell"]),
  quantity: z.number().int().positive(),
  amountMinor: z.number().int().nonnegative(),
  occurredAt: z.coerce.date(),
});

const rowSchema = z.object({
  itemDisplayName: z.string().min(1).max(200),
  transactions: z.array(transactionSchema).min(1).max(2),
});

const importInputSchema = z.object({
  currency: z.string().length(3),
  rows: z.array(rowSchema).min(1).max(2000),
});

export type ImportInput = z.input<typeof importInputSchema>;

export type ImportResult = {
  itemsCreated: number;
  itemsReused: number;
  transactionsInserted: number;
};

/**
 * Atomically import many parsed rows. Items are matched case-insensitively
 * against existing items (and against earlier rows in the same import).
 * The whole import runs inside a single DB transaction.
 */
export async function importParsedRows(
  input: ImportInput,
): Promise<ActionResult<ImportResult>> {
  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const currency = parsed.data.currency.toUpperCase();
  if (!isSupportedCurrency(currency)) {
    return { ok: false, error: `Unsupported currency: ${currency}` };
  }

  let itemsCreated = 0;
  let itemsReused = 0;
  let transactionsInserted = 0;

  await db.transaction(async (tx) => {
    // Load all existing items, indexed by case-insensitive key.
    const existing = await tx.select().from(items);
    const idByKey = new Map<string, string>();
    for (const it of existing) {
      idByKey.set(itemMatchKey(it.name), it.id);
    }

    // Walk the rows; create-on-miss, then enqueue transactions.
    const txRowsToInsert: {
      itemId: string;
      type: "buy" | "sell";
      quantity: number;
      finalValueCents: number;
      currency: string;
      occurredAt: Date;
      lotId: string;
    }[] = [];

    for (const row of parsed.data.rows) {
      const key = itemMatchKey(row.itemDisplayName);
      let itemId = idByKey.get(key);
      if (!itemId) {
        const [created] = await tx
          .insert(items)
          .values({ name: row.itemDisplayName })
          .returning({ id: items.id });
        itemId = created.id;
        idByKey.set(key, itemId);
        itemsCreated += 1;
      } else {
        itemsReused += 1;
      }
      // One lot per source row — buy + (optional) sell share this id so
      // realized profit pairs them exactly, matching the spreadsheet.
      const lotId = randomUUID();
      for (const t of row.transactions) {
        txRowsToInsert.push({
          itemId,
          type: t.type,
          quantity: t.quantity,
          finalValueCents: t.amountMinor,
          currency,
          occurredAt: t.occurredAt,
          lotId,
        });
      }
    }

    if (txRowsToInsert.length > 0) {
      // Batch-insert in chunks to avoid huge single statements.
      const CHUNK = 500;
      for (let i = 0; i < txRowsToInsert.length; i += CHUNK) {
        const chunk = txRowsToInsert.slice(i, i + CHUNK);
        await tx.insert(transactions).values(chunk);
        transactionsInserted += chunk.length;
      }
    }
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    data: { itemsCreated, itemsReused, transactionsInserted },
  };
}
