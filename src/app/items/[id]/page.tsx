export const dynamic = "force-dynamic";

import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { items as itemsTable } from "@/db/schema";
import { getItemDetail, listAllTags } from "@/lib/server/items";
import { ItemThumb } from "@/components/ItemThumb";
import { Money } from "@/components/Money";
import { ButtonLink, Card, EmptyState, StatCard } from "@/components/ui";
import { MarketPriceForm } from "./MarketPriceForm";
import { DeleteTransactionButton } from "./DeleteTransactionButton";
import { MoreMenu } from "@/components/MoreMenu";
import { DeleteItemButton } from "./DeleteItemButton";
import { displayExitReason, EXIT_REASON_LABELS } from "@/lib/calc/exit_reason";
import { MergeItemButton } from "./MergeItemButton";
import { RefreshPriceButton } from "./RefreshPriceButton";
import { EbayPricePanel } from "./EbayPricePanel";
import { PriceHistoryChart } from "@/components/PriceHistoryChart";
import { getItemPriceHistory } from "@/lib/server/price_analytics";
import { RenameItemForm } from "./RenameItemForm";
import { ImageEditor } from "./ImageEditor";
import { TagEditor } from "./TagEditor";
import { MarkReceivedButton } from "./MarkReceivedButton";
import { InlineShipping } from "./InlineShipping";
import { ItemInsights } from "./ItemInsights";
import { AliasEditor } from "./AliasEditor";
import {
  getItemInsightSummary,
  listMentionsForItem,
} from "@/lib/server/insights";
import {
  DEFAULT_TRANSACTION_CURRENCY,
  convertMinor,
  formatAmount,
  type CurrencyCode,
} from "@/lib/currency";
import { getItemCatalogInfo } from "@/lib/server/catalog_item";
import { getLifecycles } from "@/lib/server/catalog_lifecycle";
import { LifecycleCard } from "@/components/LifecycleCard";
import { ReturnBasisCard } from "@/components/ReturnBasisCard";
import { sellTargetStanding } from "@/lib/calc/sell_target";
import { SellTargetCard } from "./SellTargetCard";
import { BASES, parseBasis, type Basis } from "@/lib/calc/position_return";
import { getItemReturns } from "@/lib/server/position_returns";
import { getRate } from "@/lib/fx";
import { summarizeItem, type SummaryLine } from "@/lib/calc/item_summary";
import { priceMoveInWindow, windowBounds } from "@/lib/calc/changes";

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const basis = parseBasis((await searchParams).basis);
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
  // Parallel-fetch the YouTube-insight signals for this item. The pipeline
  // may not have run yet (or this item may have no mentions linked) — both
  // queries handle that gracefully.
  const [itemMentions, insightSummary, priceHistory] = await Promise.all([
    listMentionsForItem(id, { limit: 20 }),
    getItemInsightSummary(id),
    getItemPriceHistory(id),
  ]);

  // Linked catalogue product (TCGplayer price), if the item has been linked.
  const catalogInfo =
    item.catalogProductId != null
      ? await getItemCatalogInfo(item.catalogProductId).catch(() => null)
      : null;
  // Annualized return on each starting basis.
  const returns = await getItemReturns(id, new Date()).catch(() => null);
  const basisHrefs = Object.fromEntries(
    BASES.map((b) => [b, b === "purchase" ? `/items/${id}` : `/items/${id}?basis=${b}`]),
  ) as Record<Basis, string>;

  // Where that product is in its life, set against earlier sets.
  const lifecycle =
    item.catalogProductId != null
      ? ((
          await getLifecycles([item.catalogProductId]).catch(() => null)
        )?.get(Number(item.catalogProductId)) ?? null)
      : null;
  let usdToItem: number | null = null;
  if (catalogInfo?.latest) {
    try {
      usdToItem =
        itemCurrency === "USD"
          ? 1
          : (await getRate("USD", itemCurrency as CurrencyCode)).rate;
    } catch {
      usdToItem = null;
    }
  }

  // Plain-English summary, from numbers already on this page.
  const now = new Date();
  const boughtUnits = txs.reduce(
    (n, t) => (t.type === "buy" ? n + t.quantity : n),
    0,
  );
  const exitUnits = txs.reduce(
    (n, t) =>
      t.type === "sell" && displayExitReason(t.exitReason) !== "sold"
        ? n + t.quantity
        : n,
    0,
  );
  const { start, end } = windowBounds("week", now);
  const weekMove = priceMoveInWindow(priceHistory.points, start, end);
  const summaryLines = summarizeItem({
    held: valuation.quantity,
    pending: valuation.pendingQuantity,
    boughtUnits,
    soldUnits: valuation.soldQuantity,
    exitUnits,
    avgCost: valuation.avgCostCents,
    inventoryCost: valuation.inventoryCostCents,
    marketPrice: latestPrice?.priceCents ?? null,
    priceAgeDays: latestPrice
      ? Math.max(0, now.getTime() - latestPrice.fetchedAt.getTime()) /
        86_400_000
      : null,
    weekChangePct: weekMove.kind === "moved" ? weekMove.move.changePct : null,
    realized: valuation.realizedProfitCents,
    unrealized: valuation.unrealizedProfitCents,
    mentions:
      insightSummary.total > 0
        ? {
            total: insightSummary.total,
            bullish: insightSummary.bullish,
            bearish: insightSummary.bearish,
            channels: insightSummary.distinctChannels,
          }
        : null,
    money: (minor) => formatAmount(minor, itemCurrency),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4 min-w-0">
          <div className="flex flex-col items-start gap-1 mt-1">
            <ItemThumb
              imageUrl={item.imageUrl}
              name={item.name}
              size={96}
            />
            <ImageEditor id={item.id} hasImage={!!item.imageUrl} />
          </div>
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
            <div className="mt-3">
              <AliasEditor itemId={item.id} initialAliases={item.aliases} />
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
        </div>
        <div className="flex gap-2">
          <ButtonLink
            href={`/transactions/new?itemId=${item.id}&type=buy`}
            variant="secondary"
          >
            Log buy
          </ButtonLink>
          <ButtonLink href={`/transactions/new?itemId=${item.id}&type=sell`}>
            Log sell
          </ButtonLink>
          {/* Rare and destructive actions live one click further away. */}
          <MoreMenu>
            {valuation.quantity > 0 &&
              (
                [
                  ["gifted", "Gift away…"],
                  ["lost", "Mark lost / damaged…"],
                  ["opened", "Mark opened…"],
                ] as const
              ).map(([r, label]) => (
                <Link
                  key={r}
                  role="menuitem"
                  href={`/transactions/new?itemId=${item.id}&exit=${r}`}
                  className="rounded-md px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {label}
                </Link>
              ))}
            <MergeItemButton
              variant="menu"
              sourceId={item.id}
              sourceName={item.name}
              targets={otherItems}
            />
            <DeleteItemButton
              variant="menu"
              id={item.id}
              name={item.name}
              txCount={txs.length}
            />
          </MoreMenu>
        </div>
      </div>

      <PlainEnglish lines={summaryLines} />

      {catalogInfo && (
        <CatalogCard
          info={catalogInfo}
          itemCurrency={itemCurrency}
          usdToItem={usdToItem}
          ebayPriceMinor={latestPrice?.priceCents ?? null}
        />
      )}

      {returns && returns.results.purchase.status !== "unavailable" && (
        <ReturnBasisCard
          results={returns.results}
          basis={basis}
          hrefs={basisHrefs}
          currency={returns.currency}
          vsIndex={returns.vsIndex}
          benchLabel={returns.benchLabel}
        />
      )}

      {lifecycle && (
        <LifecycleCard
          lifecycle={lifecycle}
          releasedOn={lifecycle.releasedOn}
        />
      )}

      <SellTargetCard
        itemId={item.id}
        currency={itemCurrency}
        targetCents={item.sellTargetCents}
        standing={sellTargetStanding({
          targetCents: item.sellTargetCents,
          targetCurrency: item.sellTargetCurrency,
          priceCents: latestPrice?.priceCents ?? null,
          priceCurrency: latestPrice?.currency ?? null,
        })}
        alertedLabel={
          item.sellTargetAlertedAt
            ? item.sellTargetAlertedAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })
            : null
        }
        held={valuation.quantity}
      />

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
                  <ButtonLink href={`/transactions/new?itemId=${item.id}`}>
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
                      <Fragment key={tx.id}>
                        <tr
                          className={
                            isPending
                              ? "bg-amber-50/40 dark:bg-amber-950/10"
                              : ""
                          }
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
                                    : displayExitReason(tx.exitReason) ===
                                        "sold"
                                      ? "text-rose-600 dark:text-rose-400"
                                      : "text-amber-600 dark:text-amber-400"
                                }
                              >
                                {tx.type === "buy"
                                  ? "Buy"
                                  : displayExitReason(tx.exitReason) === "sold"
                                    ? "Sell"
                                    : EXIT_REASON_LABELS[
                                        displayExitReason(tx.exitReason)
                                      ]}
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
                        {tx.note && (
                          <tr
                            className={
                              isPending
                                ? "bg-amber-50/40 dark:bg-amber-950/10"
                                : ""
                            }
                          >
                            <td colSpan={6} className="px-4 pb-3 pt-0">
                              <div className="text-xs text-zinc-600 dark:text-zinc-400 italic border-l-2 border-zinc-300 dark:border-zinc-700 pl-2 ml-2">
                                &ldquo;{tx.note}&rdquo;
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <EbayPricePanel itemId={item.id} initialQuery={item.ebayQuery} />
          </div>
          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Price history
            </h3>
            <PriceHistoryChart
              points={priceHistory.points}
              currency={priceHistory.currency ?? itemCurrency}
            />
          </div>
          {latestPrice?.source && latestPrice.source !== "manual" && (
            <div className="text-xs text-zinc-500">
              Latest price source: {latestPrice.source} ·{" "}
              {new Date(latestPrice.fetchedAt).toLocaleString()}
            </div>
          )}
        </Card>
      </div>

      <ItemInsights
        itemName={item.name}
        mentions={itemMentions}
        summary={insightSummary}
      />
    </div>
  );
}

/**
 * The page's numbers, said in words. Sits above the stat cards so someone
 * who doesn't read a grid of figures still gets the picture first.
 */
function PlainEnglish({ lines }: { lines: SummaryLine[] }) {
  if (lines.length === 0) return null;
  const groups = [0, 1, 2]
    .map((g) => lines.filter((l) => l.group === g))
    .filter((g) => g.length > 0);
  return (
    <Card className="p-4">
      <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        In plain English
      </h2>
      <div className="mt-2 flex flex-col gap-2 text-sm leading-relaxed max-w-prose">
        {groups.map((g, i) => (
          <p key={i}>
            {g.map((l, j) => (
              <span
                key={j}
                className={
                  l.warn ? "text-amber-700 dark:text-amber-400" : undefined
                }
              >
                {j > 0 ? " " : ""}
                {l.text}
              </span>
            ))}
          </p>
        ))}
      </div>
    </Card>
  );
}

const usdText = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * The linked catalogue product and its TCGplayer market price, set beside
 * the item's own (eBay) price so the two can be compared at a glance.
 */
function CatalogCard({
  info,
  itemCurrency,
  usdToItem,
  ebayPriceMinor,
}: {
  info: NonNullable<Awaited<ReturnType<typeof getItemCatalogInfo>>>;
  itemCurrency: string;
  usdToItem: number | null;
  ebayPriceMinor: number | null;
}) {
  const latest = info.latest;
  const change =
    latest && info.prior && info.prior.marketCents > 0
      ? latest.marketCents / info.prior.marketCents - 1
      : null;
  const days =
    latest && info.prior
      ? Math.round(
          (latest.day.getTime() - info.prior.day.getTime()) / 86_400_000,
        )
      : null;
  const inItem =
    latest && usdToItem != null
      ? convertMinor(latest.marketCents, "USD", itemCurrency, usdToItem)
      : null;
  const asOf = latest?.day.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const vsEbay =
    ebayPriceMinor != null && inItem != null && inItem > 0
      ? (ebayPriceMinor / inItem - 1) * 100
      : null;
  return (
    <Card className="p-4">
      <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        Catalogue price (TCGplayer)
      </h2>
      <div className="mt-1.5 text-sm">
        <span className="font-medium">{info.name}</span>{" "}
        <span className="text-zinc-500">
          · {info.setName} · {info.language === "ja" ? "Japanese" : "English"}
        </span>
      </div>
      {latest ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-2xl font-semibold tabular-nums">
            {usdText(latest.marketCents)}
          </span>
          {inItem != null && (
            <span className="text-sm text-zinc-500 tabular-nums">
              ≈ <Money amount={inItem} currency={itemCurrency} />
            </span>
          )}
          {change != null && days != null && (
            <span
              className={`text-sm tabular-nums ${
                change > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : change < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-zinc-500"
              }`}
            >
              {change > 0 ? "+" : change < 0 ? "−" : ""}
              {Math.abs(change * 100).toFixed(1)}% over {days} days
            </span>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">
          TCGplayer has no market price for this product yet.
        </p>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        {asOf ? `As of ${asOf}. ` : ""}
        {vsEbay != null
          ? `Your eBay price is ${Math.abs(vsEbay).toFixed(0)}% ${vsEbay >= 0 ? "above" : "below"} it. `
          : ""}
        {info.url && (
          <a
            href={info.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
          >
            View on TCGplayer ↗
          </a>
        )}
      </p>
    </Card>
  );
}
