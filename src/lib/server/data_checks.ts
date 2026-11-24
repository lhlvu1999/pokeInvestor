import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { items, transactions } from "@/db/schema";
import { findDataIssues, type Finding } from "@/lib/calc/data_checks";

/** Entries that look like slips, newest first within each kind. */
export async function getDataIssues(now = new Date()): Promise<Finding[]> {
  const rows = await db
    .select({
      id: transactions.id,
      itemId: transactions.itemId,
      itemName: items.name,
      type: transactions.type,
      quantity: transactions.quantity,
      finalValueCents: transactions.finalValueCents,
      occurredAt: transactions.occurredAt,
      exitReason: transactions.exitReason,
    })
    .from(transactions)
    .innerJoin(items, eq(transactions.itemId, items.id));
  return findDataIssues(rows, now);
}
