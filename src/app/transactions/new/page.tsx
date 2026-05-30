export const dynamic = "force-dynamic";

import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { items, transactions } from "@/db/schema";
import { ButtonLink, Card, EmptyState } from "@/components/ui";
import { NewTransactionForm } from "./NewTransactionForm";
import { DEFAULT_TRANSACTION_CURRENCY } from "@/lib/currency";
import { computeHoldings } from "@/lib/calc/holdings";

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const defaultType: "buy" | "sell" = sp.type === "sell" ? "sell" : "buy";
  const allItems = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .orderBy(asc(items.name));

  // Build per-item currency + held quantity so the form can show held count
  // and lock currency once an item already has transactions.
  const txRows = await db.select().from(transactions);
  const itemCurrency: Record<string, string> = {};
  const txByItem = new Map<string, typeof txRows>();
  for (const r of txRows) {
    itemCurrency[r.itemId] = r.currency;
    const list = txByItem.get(r.itemId) ?? [];
    list.push(r);
    txByItem.set(r.itemId, list);
  }
  const itemHeld: Record<string, number> = {};
  for (const [itemId, list] of txByItem) {
    try {
      itemHeld[itemId] = computeHoldings(list).quantity;
    } catch {
      itemHeld[itemId] = 0;
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h1 className="text-2xl font-semibold">New transaction</h1>

      {allItems.length === 0 ? (
        <EmptyState
          title="No items yet"
          description="Create an item before logging transactions."
          action={
            <ButtonLink
              href={`/items/new?returnTo=${encodeURIComponent(
                `/transactions/new?type=${defaultType}`,
              )}`}
            >
              New item
            </ButtonLink>
          }
        />
      ) : (
        <Card className="p-5">
          <NewTransactionForm
            items={allItems}
            itemCurrency={itemCurrency}
            itemHeld={itemHeld}
            defaultItemId={sp.itemId ?? null}
            defaultType={defaultType}
            defaultCurrency={DEFAULT_TRANSACTION_CURRENCY}
          />
          <p className="text-xs text-zinc-500 mt-4">
            Final value is the total amount for the whole transaction —
            already including shipping/fees for buys, or net of fees for
            sells.
          </p>
        </Card>
      )}
    </div>
  );
}
