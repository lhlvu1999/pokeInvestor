export const dynamic = "force-dynamic";

import Link from "next/link";
import { Money } from "@/components/Money";
import { ButtonLink, Card, EmptyState } from "@/components/ui";
import { CashflowTagFilter } from "@/components/CashflowTagFilter";
import { CashflowExplorer } from "@/components/dashboard/CashflowExplorer";
import { currentMonthKey, parseRangeParams } from "@/lib/calc/cashflow_window";
import { CollapsibleRows } from "@/components/CollapsibleRows";
import { ConcentrationHeatmap } from "@/components/ConcentrationHeatmap";
import { TagBadge } from "@/components/TagBadge";
import { AttentionPanel } from "@/components/dashboard/AttentionPanel";
import { CapitalCard } from "@/components/dashboard/CapitalCard";
import { ChangesButton } from "@/components/dashboard/ChangesPanel";
import { MoversPanel } from "@/components/dashboard/MoversPanel";
import { PortfolioHero } from "@/components/dashboard/PortfolioHero";
import { TopPositions } from "@/components/dashboard/TopPositions";
import { BulkPriceRefresh } from "@/app/items/BulkPriceRefresh";
import { buildAttentionItems } from "@/lib/calc/attention";
import { formatCompactAmount } from "@/lib/currency";
import {
  getDashboardData,
  getCashflowLines,
  getPortfolioValueSeries,
  rollupByTag,
  type TagRollup,
} from "@/lib/server/portfolio";
import { getCapitalFlow } from "@/lib/server/capital";
import { listPriceRefreshTargets } from "@/lib/server/prices";
import {
  getPriceAnalytics,
  MOVER_WINDOW_DAYS,
} from "@/lib/server/price_analytics";
import { getPendingDeliveries } from "@/lib/server/pending";
import { safe } from "@/lib/server/safe";
import { getSellCandidates } from "@/lib/server/sell_scorecard";
import { getCostMethod, getDisplayCurrency } from "@/lib/server/settings";
import { listWatchlist } from "@/lib/server/watchlist";

/** A sell candidate must clear this to be raised on the dashboard. Matches
 * the "red" threshold on the Insights scorecard, so the two never disagree
 * about what counts as a strong signal. */
const SELL_SIGNAL_MIN_SCORE = 0.6;
/** Tag rows shown before the rest collapse behind "Show more". */
const TAG_ROWS_VISIBLE = 8;

function formatRateLine(
  notes: { from: string; to: string; rate: number; stale: boolean }[],
): string | null {
  if (notes.length === 0) return null;
  const parts = notes.map(
    (n) =>
      `1 ${n.from} ≈ ${n.rate.toFixed(6)} ${n.to}${n.stale ? " (cached)" : ""}`,
  );
  return parts.join(" · ");
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    cashflowTags?: string;
    cf?: string;
    cffrom?: string;
    cfto?: string;
  }>;
}) {
  const sp = await searchParams;
  const activeCashflowTags = sp.cashflowTags
    ? sp.cashflowTags
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];

  const cashflowRange = parseRangeParams(sp);

  const [displayCurrency, costMethod] = await Promise.all([
    getDisplayCurrency(),
    getCostMethod(),
  ]);
  // Loaded once and shared: the price analytics and sell scorecard below
  // both need every item's valuation, and recomputing it per panel would
  // repeat the FX lookups on the same request.
  const dash = await getDashboardData(displayCurrency);
  const { items, converted, summary, fxNotes } = dash;

  // Resolve tag filter → set of item ids matching ALL active tags.
  let cashflowItemIds: ReadonlySet<string> | undefined;
  if (activeCashflowTags.length > 0) {
    const matching = items
      .filter(({ item }) =>
        activeCashflowTags.every((t) => item.tags.includes(t)),
      )
      .map(({ item }) => item.id);
    cashflowItemIds = new Set(matching);
  }

  const [
    cashflowData,
    portfolioSeries,
    priceData,
    pending,
    refreshTargets,
    sellCandidates,
    watchlistRows,
    capital,
  ] = await Promise.all([
    getCashflowLines(displayCurrency, { itemIdsFilter: cashflowItemIds }),
    getPortfolioValueSeries(displayCurrency),
    getPriceAnalytics(displayCurrency, dash),
    getPendingDeliveries(displayCurrency),
    listPriceRefreshTargets(true),
    // Optional panels: a failure here degrades to "nothing to show"
    // instead of a 500 on the front page.
    safe(
      "sell signals",
      () =>
        getSellCandidates({
          items,
          converted,
          windowDays: 60,
          limit: 10,
        }),
      [],
    ),
    safe("watchlist", () => listWatchlist(), []),
    safe("capital flow", () => getCapitalFlow(displayCurrency), null),
  ]);

  const now = new Date();
  const lastPricedAt = priceData.positions.reduce<Date | null>(
    (latest, p) =>
      p.lastPricedAt && (!latest || p.lastPricedAt > latest)
        ? p.lastPricedAt
        : latest,
    null,
  );

  const strongSell = sellCandidates.filter(
    (c) => c.score >= SELL_SIGNAL_MIN_SCORE,
  );
  const bullishWatch = watchlistRows.filter(
    (r) => r.bullish > 0 && r.bullish > r.bearish,
  );

  const attention = buildAttentionItems({
    now,
    formatMoney: (m) => formatCompactAmount(m, displayCurrency),
    pending,
    unpriced: {
      count: summary.unpricedItemsHeld,
      costDisplay: summary.investedUnpriced,
    },
    latestPriceAt: lastPricedAt,
    sell: {
      count: strongSell.length,
      names: strongSell.map((c) => c.name),
    },
    watchlist: {
      count: bullishWatch.length,
      names: bullishWatch.map((r) => r.entry.name),
    },
  });

  const fxLine = formatRateLine(fxNotes);
  const tagRollup = rollupByTag(items, converted);
  const showCapital = capital != null && capital.flow.spent > 0;
  const showSideColumn = tagRollup.length > 0 || showCapital;

  // All tags that appear on any item — surface as chips above the chart.
  const allTags = Array.from(
    new Set(items.flatMap(({ item }) => item.tags)),
  ).sort();

  function chipHrefForTag(tag: string): string {
    const next = activeCashflowTags.includes(tag)
      ? activeCashflowTags.filter((t) => t !== tag)
      : [...activeCashflowTags, tag];
    return next.length === 0 ? "/" : `/?cashflowTags=${next.join(",")}`;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            All amounts in {displayCurrency} · cost basis{" "}
            {costMethod === "fifo" ? "FIFO" : "average"} ·{" "}
            <Link href="/settings" className="hover:underline">
              change
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ChangesButton />
          <BulkPriceRefresh
            targets={refreshTargets.eligible}
            onCooldown={refreshTargets.onCooldown}
          />
          <ButtonLink href="/transactions/new">Add transaction</ButtonLink>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No items yet"
          description="Add your first item, then log buy and sell transactions to start tracking profit."
          action={
            <ButtonLink href="/items/new">Add your first item</ButtonLink>
          }
        />
      ) : (
        <>
          {/* 1 + 2 — How am I doing, and what needs me. Side by side so the
              first screen answers both without scrolling. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2">
              <PortfolioHero
                summary={summary}
                currency={displayCurrency}
                series={portfolioSeries}
                lastPricedAt={lastPricedAt}
                now={now}
              />
            </div>
            <AttentionPanel items={attention} />
          </div>

          {/* 3 — What do I hold, and what's moving. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2">
              <TopPositions
                items={items}
                converted={converted}
                currency={displayCurrency}
              />
            </div>
            <MoversPanel
              gainers={priceData.topGainers}
              losers={priceData.topLosers}
              windowDays={MOVER_WINDOW_DAYS}
            />
          </div>

          {/* 4 — How did I get here. Reference material, so it sits below
              the answers. Cashflow gets the left column; the tag breakdowns
              stack beside it, so nothing runs edge to edge. */}
          <div
            className={`grid grid-cols-1 gap-4 items-start ${
              showSideColumn ? "lg:grid-cols-2" : ""
            }`}
          >
            <div className="min-w-0">
              <CashflowExplorer
                lines={cashflowData.lines}
                bounds={cashflowData.bounds}
                currency={displayCurrency}
                initialRange={cashflowRange}
                nowMonth={currentMonthKey(now)}
                filterLabel={
                  activeCashflowTags.length > 0
                    ? activeCashflowTags.join(" + ")
                    : null
                }
                filterSlot={
                  <CashflowTagFilter
                    chips={allTags.map((tag) => ({
                      tag,
                      href: chipHrefForTag(tag),
                      active: activeCashflowTags.includes(tag),
                    }))}
                    activeCount={activeCashflowTags.length}
                    clearHref="/"
                  />
                }
              />
            </div>
            {showSideColumn && (
              <div className="min-w-0 flex flex-col gap-4">
                {showCapital && (
                  <CapitalCard
                    flow={capital.flow}
                    currency={displayCurrency}
                    totalProfit={summary.total}
                    skipped={capital.skipped}
                  />
                )}
                {tagRollup.length > 0 && (
                  <Card className="p-4">
                    <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                      <h2 className="font-medium text-sm">
                        Concentration{" "}
                        <span className="text-xs text-zinc-500 font-normal">
                          inventory value by tag
                        </span>
                      </h2>
                    </div>
                    <ConcentrationHeatmap
                      rollup={tagRollup}
                      currency={displayCurrency}
                    />
                  </Card>
                )}

                {tagRollup.length > 0 && (
                  <Card className="overflow-hidden">
                    <div className="p-4 border-b border-zinc-200/80 dark:border-zinc-800 flex items-baseline justify-between gap-2 flex-wrap">
                      <h2 className="font-medium text-sm">
                        By tag{" "}
                        <span className="text-xs text-zinc-500 font-normal">
                          sorted by total spent
                        </span>
                      </h2>
                      <span
                        className="text-[11px] text-zinc-500"
                        title="Items can have several tags, so totals across tags can exceed the portfolio total."
                      >
                        items can have several tags
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200/80 dark:border-zinc-800">
                          <tr>
                            <th className="px-2 xl:px-3 py-2 text-left font-medium">
                              Tag
                            </th>
                            <th
                              className="px-2 xl:px-3 py-2 text-right font-medium"
                              title="In stock / total items with this tag"
                            >
                              Stock
                            </th>
                            <th className="px-2 xl:px-3 py-2 text-right font-medium">
                              Spent
                            </th>
                            <th className="hidden xl:table-cell px-2 xl:px-3 py-2 text-right font-medium">
                              Received
                            </th>
                            <th className="px-2 xl:px-3 py-2 text-right font-medium">
                              Realized
                            </th>
                            <th
                              className="px-2 xl:px-3 py-2 text-right font-medium"
                              title="Realized profit ÷ total spent"
                            >
                              Margin
                            </th>
                            <th className="px-2 xl:px-3 py-2 text-right font-medium">
                              Stock value
                            </th>
                          </tr>
                        </thead>
                        <CollapsibleRows
                          visible={tagRollup
                            .slice(0, TAG_ROWS_VISIBLE)
                            .map((r) => (
                              <TagRow
                                key={r.tag}
                                r={r}
                                currency={displayCurrency}
                              />
                            ))}
                          hidden={tagRollup.slice(TAG_ROWS_VISIBLE).map((r) => (
                            <TagRow
                              key={r.tag}
                              r={r}
                              currency={displayCurrency}
                            />
                          ))}
                          hiddenCount={Math.max(
                            0,
                            tagRollup.length - TAG_ROWS_VISIBLE,
                          )}
                          colSpan={7}
                          noun="tags"
                        />
                      </table>
                    </div>
                  </Card>
                )}
              </div>
            )}
          </div>

          {fxLine && <div className="text-xs text-zinc-500">FX: {fxLine}</div>}
        </>
      )}
    </div>
  );
}

function TagRow({ r, currency }: { r: TagRollup; currency: string }) {
  const margin = r.totalSpent > 0 ? (r.realized / r.totalSpent) * 100 : null;
  const marginColor =
    margin == null
      ? "text-zinc-400"
      : margin > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : margin < 0
          ? "text-rose-600 dark:text-rose-400"
          : "text-zinc-500";
  return (
    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
      <td className="px-2 xl:px-3 py-2.5">
        <TagBadge tag={r.tag} />
      </td>
      <td className="px-2 xl:px-3 py-2.5 text-right tabular-nums">
        {r.itemsHeld}
        <span className="text-zinc-400">/{r.itemCount}</span>
      </td>
      <td className="px-2 xl:px-3 py-2.5 text-right tabular-nums">
        <Money amount={r.totalSpent} currency={currency} />
      </td>
      <td className="hidden xl:table-cell px-2 xl:px-3 py-2.5 text-right tabular-nums">
        <Money amount={r.totalReceived} currency={currency} />
      </td>
      <td className="px-2 xl:px-3 py-2.5 text-right tabular-nums">
        <Money amount={r.realized} currency={currency} signed />
      </td>
      <td
        className={`px-2 xl:px-3 py-2.5 text-right tabular-nums font-medium ${marginColor}`}
      >
        {margin == null ? "—" : `${margin > 0 ? "+" : ""}${margin.toFixed(1)}%`}
      </td>
      <td className="px-2 xl:px-3 py-2.5 text-right tabular-nums">
        <Money amount={r.inventoryCost} currency={currency} />
      </td>
    </tr>
  );
}
