export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { items, transactions } from "@/db/schema";
import { Card } from "@/components/ui";
import { EditTransactionForm } from "./EditTransactionForm";
import { minorToDecimalString } from "@/lib/currency";

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!tx) notFound();
  const [item] = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(eq(items.id, tx.itemId))
    .limit(1);

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div>
        <Link
          href={`/items/${tx.itemId}`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← {item?.name ?? "Item"}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Edit transaction</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Currency is locked to {tx.currency}. To change currency, delete and
          re-create the transaction.
        </p>
      </div>
      <Card className="p-5">
        <EditTransactionForm
          transaction={{
            id: tx.id,
            itemId: tx.itemId,
            itemName: item?.name ?? "",
            type: tx.type,
            quantity: tx.quantity,
            // Item cost = total − shipping. Show only the item portion in the
            // "Item cost" field so the user edits each piece independently.
            itemCostDecimal: minorToDecimalString(
              tx.finalValueCents - (tx.shippingCents ?? 0),
              tx.currency,
            ),
            shippingDecimal:
              tx.shippingCents != null
                ? minorToDecimalString(tx.shippingCents, tx.currency)
                : "",
            currency: tx.currency,
            occurredAt: tx.occurredAt,
            note: tx.note ?? "",
            status: tx.status,
          }}
        />
      </Card>
    </div>
  );
}
