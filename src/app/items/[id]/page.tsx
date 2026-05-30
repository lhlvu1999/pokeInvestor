export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { items as itemsTable } from "@/db/schema";
import { getItemDetail, listAllTags } from "@/lib/server/items";
import { Money } from "@/components/Money";
import { ButtonLink, Card, EmptyState, StatCard } from "@/components/ui";
import { MarketPriceForm } from "./MarketPriceForm";
import { DeleteTransactionButton } from "./DeleteTransactionButton";
import { DeleteItemButton } from "./DeleteItemButton";
import { RefreshPriceButton } from "./RefreshPriceButton";
import { RenameItemForm } from "./RenameItemForm";
import { TagEditor } from "./TagEditor";
import { MarkReceivedButton } from "./MarkReceivedButton";
import { InlineShipping } from "./InlineShipping";
import { DEFAULT_TRANSACTION_CURRENCY } from "@/lib/currency";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getItemDetail(id);
  if (!detail) notFound();
  const { item, valuation, latestPrice, transactions: txs } = detail;
  const itemCurrency =
    valuation.currency || latestPrice?.currency || DEFAULT_TRANSACTION_CURRENCY;

  // List of other item names so the rename form can warn before a merge.
  const otherItems = await db
    .select({ id: itemsTable.id, name: itemsTable.name })
    .from(itemsTable)
    .where(ne(itemsTable.id, id))
    .orderBy(asc(itemsTable.name));
  const knownTags = await listAllTags();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/items"
            className="text-sm text-zinc-500 hover:underline"
          >
            ← Items
          </Link>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{item.name}</h1>
            <RenameItemForm
              id={item.id}
              currentName={item.name}
              existingNames={otherItems}
            />
          </div>
          {(item.setCode || item.cardNumber) && (
            <div className="text-sm text-zinc-500">
              {[item.setCode, item.cardNumber].filter(Boolean).join(" • ")}
            </div>
          )}
          <div className="mt-2">
            <TagEditor
              itemId={item.id}
              initialTags={item.tags}
              knownTags={knownTags}
            />
          </div>
          {item.note && (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-prose">
              {item.note}
            </p>
          )}
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline break-all"
            >
              {item.sourceUrl} ↗
            </a>
          )}
        </div>
        <div className="flex gap-2">
          <ButtonLink
            href={`/transactions/new?itemId=${item.id}&type=buy`}
            variant="secondary"
          >
            Log buy
          </ButtonLink>
          <ButtonLink
            href={`/transactions/new?itemId=${item.id}&type=sell`}
          >
            Log sell
          </ButtonLink>
          <DeleteItemButton
            id={item.id}
            name={item.name}
            txCount={txs.length}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard label="Held">
          <span className="tabular-nums">{valuation.quantity}</span>
        </StatCard>
        <StatCard label="Avg cost" hint="Per remaining unit">
          <Money
            amount={valuation.avgCostCents}
            currency={valuation.currency}
          />
        </StatCard>
        <StatCard label="Market price">
          <Money
            amount={latestPrice?.priceCents ?? null}
            currency={latestPrice?.currency ?? null}
          />
        </StatCard>
        <StatCard label="Inventory cost" hint="Held × avg cost">
          <Money
            amount={valuation.inventoryCostCents}
            currency={valuation.currency}
          />
        </StatCard>
        <StatCard label="Total spent" hint="Lifetime cost of all buys">
          <Money
            amount={valuation.totalBoughtCents}
            currency={valuation.currency}
          />
        </StatCard>
        <StatCard label="Total received" hint="Lifetime revenue from sells">
          <Money
            amount={valuation.totalSoldCents}
            currency={valuation.currency}
          />
        </StatCard>
        <StatCard label="Realized">
          <Money
            amount={valuation.realizedProfitCents}
            currency={valuation.currency}
            signed
          />
        </StatCard>
        <StatCard label="Unrealized">
          <Money
            amount={valuation.unrealizedProfitCents}
            currency={valuation.currency}
            signed
          />
        </StatCard>
        {valuation.pendingQuantity > 0 && (
          <StatCard
            label="On the way"
            hint={`${valuation.pendingQuantity} unit(s) committed`}
          >
            <Money
              amount={valuation.pendingCostCents}
              currency={valuation.currency}
            />
          </StatCard>
        )}
        {valuation.totalShippingCents > 0 && (
          <StatCard label="Total shipping" hint="Lifetime shipping recorded">
            <Money
              amount={valuation.totalShippingCents}
              currency={valuation.currency}
            />
          </StatCard>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="font-medium">Transaction history</h2>
            </div>
            {txs.length === 0 ? (
              <EmptyState
                title="No transactions yet"
                description="Log a buy to start tracking holdings."
                action={
                  <ButtonLink
                    href={`/transactions/new?itemId=${item.id}`}
                  >
                    Add transaction
                  </ButtonLink>
                }
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Date</th>
                    <th className="text-left font-medium px-4 py-2">Type</th>
                    <th className="text-right font-medium px-4 py-2">Qty</th>
                    <th className="text-right font-medium px-4 py-2">Total</th>
                    <th className="text-right font-medium px-4 py-2">
                      Per unit
                    </th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {txs.map((tx) => {
                    const isPending =
                      tx.type === "buy" && tx.status === "pending";
                    return (
                      <tr
                        key={tx.id}
                        className={isPending ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}
                      >
                        <td className="px-4 py-2 whitespace-nowrap text-zinc-500">
                          {new Date(tx.occurredAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                tx.type === "buy"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              }
                            >
                              {tx.type === "buy" ? "Buy" : "Sell"}
                            </span>
                            {isPending && (
                              <span className="inline-flex items-center rounded-full border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                On the way
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {tx.quantity}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          <Money
                            amount={tx.finalValueCents}
                            currency={tx.currency}
                          />
                          {tx.type === "buy" && (
                            <div className="mt-0.5">
                              <InlineShipping
                                id={tx.id}
                                currency={tx.currency}
                                shippingCents={tx.shippingCents ?? null}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
                          <Money
                            amount={Math.round(
                              tx.finalValueCents / tx.quantity,
                            )}
                            currency={tx.currency}
                          />
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {isPending && (
                            <span className="inline-block mr-2 align-middle">
                              <MarkReceivedButton id={tx.id} />
                            </span>
                          )}
                          <Link
                            href={`/transactions/${tx.id}/edit`}
                            className="text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 mr-3"
                          >
                            Edit
                          </Link>
                          <DeleteTransactionButton id={tx.id} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <Card className="p-4 h-fit space-y-4">
          <div>
            <h2 className="font-medium mb-2">Market price</h2>
            <p className="text-xs text-zinc-500 mb-3">
              Manually set the current market price per unit, or fetch it from
              PriceCharting if you&apos;ve configured an API token + product ID.
            </p>
            <MarketPriceForm
              itemId={item.id}
              currentMinor={latestPrice?.priceCents ?? null}
              currency={latestPrice?.currency ?? itemCurrency}
              currencyLocked={Boolean(valuation.currency)}
            />
          </div>
          {item.pricechartingId && (
            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 mb-2">
                PriceCharting ID:{" "}
                <span className="font-mono">{item.pricechartingId}</span>
              </div>
              <RefreshPriceButton itemId={item.id} />
            </div>
          )}
          {latestPrice?.source && latestPrice.source !== "manual" && (
            <div className="text-xs text-zinc-500">
              Latest price source: {latestPrice.source} ·{" "}
              {new Date(latestPrice.fetchedAt).toLocaleString()}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
