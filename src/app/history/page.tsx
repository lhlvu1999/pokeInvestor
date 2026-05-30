export const dynamic = "force-dynamic";

import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { items, transactions } from "@/db/schema";
import { ButtonLink, EmptyState } from "@/components/ui";
import { HistoryTable, type HistoryRow } from "./HistoryTable";

export default async function HistoryPage() {
  const rows = await db
    .select({
      id: transactions.id,
      itemId: transactions.itemId,
      itemName: items.name,
      type: transactions.type,
      quantity: transactions.quantity,
      finalValueCents: transactions.finalValueCents,
      currency: transactions.currency,
      occurredAt: transactions.occurredAt,
      note: transactions.note,
      lotId: transactions.lotId,
    })
    .from(transactions)
    .innerJoin(items, eq(transactions.itemId, items.id))
    .orderBy(desc(transactions.occurredAt));

  // Convert the Date to plain string for serializable client props.
  const data: HistoryRow[] = rows.map((r) => ({
    ...r,
    occurredAt: r.occurredAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Transaction history</h1>
          <p className="text-xs text-zinc-500 mt-1">
            All transactions across all items, newest first.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/api/export/transactions"
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Export CSV
          </a>
          <ButtonLink href="/transactions/new">Add transaction</ButtonLink>
        </div>
      </div>

      {data.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          description="Add transactions or import from CSV to start tracking."
          action={
            <ButtonLink href="/transactions/new">Add transaction</ButtonLink>
          }
        />
      ) : (
        <HistoryTable rows={data} />
      )}
    </div>
  );
}
