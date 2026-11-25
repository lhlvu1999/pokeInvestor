export const dynamic = "force-dynamic";

import { asc, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { items, marketPrices, transactions } from "@/db/schema";
import { ButtonLink, Card, EmptyState } from "@/components/ui";
import { NewTransactionForm } from "./NewTransactionForm";
import { loadItemSetNames } from "@/lib/server/catalog_item_sets";
import { DEFAULT_TRANSACTION_CURRENCY } from "@/lib/currency";
import { computeHoldings } from "@/lib/calc/holdings";
import { lastBuyPerUnit } from "@/lib/calc/entry_hints";
import { isExitReason } from "@/lib/calc/exit_reason";

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string; type?: string; exit?: string }>;
}) {
  const sp = await searchParams;
  // ?exit=gifted|lost|opened opens the form as a non-sale exit.
  const defaultExit = isExitReason(sp.exit) ? sp.exit : "sold";
  const defaultType: "buy" | "sell" =
    sp.type === "sell" || defaultExit !== "sold" ? "sell" : "buy";
  const allItems = await db
    .select({ id: items.id, name: items.name, imageUrl: items.imageUrl })
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
  const itemLastBuy: Record<string, number> = {};
  for (const [itemId, list] of txByItem) {
    try {
      itemHeld[itemId] = computeHoldings(list).quantity;
    } catch {
      itemHeld[itemId] = 0;
    }
    const last = lastBuyPerUnit(list);
    if (last != null) itemLastBuy[itemId] = last;
  }

  // Newest market price per item, so the form can offer it as the cost.
  // Only its currency matters for display; prices are stored in the item's
  // transaction currency.
  const latestPrices = await db
    .selectDistinctOn([marketPrices.itemId], {
      itemId: marketPrices.itemId,
      priceCents: marketPrices.priceCents,
      currency: marketPrices.currency,
    })
    .from(marketPrices)
    .orderBy(marketPrices.itemId, desc(marketPrices.fetchedAt));
  const itemMarket: Record<string, { priceMinor: number; currency: string }> =
    {};
  for (const p of latestPrices) {
    itemMarket[p.itemId] = { priceMinor: p.priceCents, currency: p.currency };
  }

  const itemSet = await loadItemSetNames();

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
            itemMarket={itemMarket}
            itemLastBuy={itemLastBuy}
            itemSet={itemSet}
            defaultItemId={sp.itemId ?? null}
            defaultType={defaultType}
            defaultExit={defaultExit}
            defaultCurrency={DEFAULT_TRANSACTION_CURRENCY}
          />
          <p className="text-xs text-zinc-500 mt-4">
            Final value is the total amount for the whole transaction — already
            including shipping/fees for buys, or net of fees for sells.
          </p>
        </Card>
      )}
    </div>
  );
}
