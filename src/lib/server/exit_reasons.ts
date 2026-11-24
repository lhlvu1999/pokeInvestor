"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";
import { bulkReasonError } from "@/lib/calc/data_checks";
import type { ActionResult } from "./items";

/**
 * Say why several sells left stock: gifted, lost or opened.
 *
 * Only sells with no reason yet are touched, and only the reason changes: the
 * money, the dates, the cost of what left and so your realized profit stay
 * exactly as they were. What changes is that these stop counting as sales in
 * the win rate and margin.
 */
export async function setExitReasons(
  ids: string[],
  reason: string,
): Promise<ActionResult<{ changed: number }>> {
  const problem = bulkReasonError(ids, reason);
  if (problem) return { ok: false, error: problem };
  const rows = await db
    .update(transactions)
    .set({ exitReason: reason })
    .where(
      and(
        inArray(transactions.id, ids),
        eq(transactions.type, "sell"),
        isNull(transactions.exitReason),
      ),
    )
    .returning({ id: transactions.id });
  for (const p of ["/", "/analytics", "/analytics/annual", "/history", "/items"]) {
    revalidatePath(p);
  }
  return { ok: true, data: { changed: rows.length } };
}
