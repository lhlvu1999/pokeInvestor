export const dynamic = "force-dynamic";

import { asc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { items as itemsTable } from "@/db/schema";
import { Card, EmptyState } from "@/components/ui";
import { Money } from "@/components/Money";
import { getDisplayCurrency } from "@/lib/server/settings";
import { listWatchlist } from "@/lib/server/watchlist";
import { getStageInfos, type StageInfo } from "@/lib/server/watchlist_stage";
import { StageAlertToggle } from "./StageAlertToggle";
import { ageLabel } from "@/lib/calc/lifecycle";
import { SEALED_TYPE_LABELS } from "@/lib/calc/sealed_type";
import { changeLabel } from "@/lib/calc/set_list";
import { AddWatchlistForm, type ExistingItem } from "./AddWatchlistForm";
import { WatchlistRowActions } from "./WatchlistRowActions";

function daysAgo(d: Date | null): string {
  if (!d) return "—";
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default async function WatchlistPage() {
  const [rows, existingItems, displayCurrency] = await Promise.all([
    listWatchlist(),
    db
      .select({ id: itemsTable.id, name: itemsTable.name })
      .from(itemsTable)
      .orderBy(asc(itemsTable.name)),
    getDisplayCurrency(),
  ]);
  const existing: ExistingItem[] = existingItems;
  const stages = await getStageInfos(rows).catch(
    () => new Map<string, StageInfo>(),
  );

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Products you want to buy but haven&apos;t yet. Signal counts show
          creator sentiment from the last 30 days — matched by linked item if
          set, otherwise by fuzzy name.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <AddWatchlistForm
            existingItems={existing}
            defaultCurrency={displayCurrency}
          />
        </div>

        <div className="lg:col-span-2">
          {rows.length === 0 ? (
            <EmptyState
              title="Watchlist is empty"
              description="Add a product to track creator sentiment and set a target buy price."
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">
                        Product
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Target
                      </th>
                      <th
                        className="px-4 py-2 text-right font-medium"
                        title="Bullish / neutral / bearish mentions in last 30d"
                      >
                        Signals (30d)
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Last mention
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Added
                      </th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {rows.map(
                      ({
                        entry,
                        linkedItemName,
                        bullish,
                        bearish,
                        neutral,
                        lastMentionedAt,
                      }) => (
                        <tr
                          key={entry.id}
                          className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                        >
                          <td className="px-4 py-2.5 min-w-[15rem]">
                            <div className="font-medium">{entry.name}</div>
                            {linkedItemName &&
                              linkedItemName !== entry.name && (
                                <div className="text-[11px] text-zinc-500">
                                  linked:{" "}
                                  <Link
                                    href={`/items/${entry.itemId}`}
                                    className="hover:underline"
                                  >
                                    {linkedItemName}
                                  </Link>
                                </div>
                              )}
                            {entry.note && (
                              <div className="text-[11px] text-zinc-500 italic mt-0.5 max-w-md">
                                &ldquo;{entry.note}&rdquo;
                              </div>
                            )}
                            {(() => {
                              const st = stages.get(entry.id);
                              const canFire = st?.kind != null && st.low != null;
                              return (
                                <div className="mt-1 flex flex-col gap-1">
                                  {st && st.ageDays != null && (
                                    <div className="text-[11px] text-zinc-500 max-w-md leading-relaxed">
                                      {`${ageLabel(st.ageDays)}${
                                        st.own
                                          ? `, ${changeLabel(st.own.change)} since ${st.own.baseAge === 0 ? "release" : `day ${st.own.baseAge}`}`
                                          : ""
                                      }. `}
                                      {st.kind && st.low
                                        ? `${SEALED_TYPE_LABELS[st.kind]} have usually been lowest around day ${st.low.age} (${changeLabel(st.low.median)}; the middle half of sets between ${changeLabel(st.low.p25)} and ${changeLabel(st.low.p75)}, ${st.low.sets} sets).${st.atLow ? " This one is at that point now." : ""}`
                                        : st.kind
                                          ? `${SEALED_TYPE_LABELS[st.kind]} have no consistent low point to point at.`
                                          : "No comparison for this kind of product."}
                                    </div>
                                  )}
                                  {entry.itemId && (
                                    <StageAlertToggle
                                      entryId={entry.id}
                                      on={entry.stageAlert}
                                      disabled={!canFire}
                                    />
                                  )}
                                  {entry.stageAlert && !canFire && (
                                    <div className="text-[11px] text-amber-700 dark:text-amber-400">
                                      This alert can&apos;t fire: it needs an item
                                      linked to the catalogue, of a kind with a usual low.
                                    </div>
                                  )}
                                  {entry.stageAlertedAt && (
                                    <div className="text-[11px] text-zinc-500">
                                      {`Alert sent ${daysAgo(entry.stageAlertedAt)}.`}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {entry.targetBuyPriceCents == null ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              <Money
                                amount={entry.targetBuyPriceCents}
                                currency={entry.currency}
                              />
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                            {bullish + neutral + bearish === 0 ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              <>
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  {bullish}
                                </span>
                                <span className="text-zinc-400"> / </span>
                                <span className="text-zinc-500">{neutral}</span>
                                <span className="text-zinc-400"> / </span>
                                <span className="text-rose-600 dark:text-rose-400">
                                  {bearish}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-zinc-500">
                            {daysAgo(lastMentionedAt)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-zinc-500">
                            {daysAgo(entry.addedAt)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <WatchlistRowActions
                              entryId={entry.id}
                              entryName={entry.name}
                              linkedItemId={entry.itemId}
                            />
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
