export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card, EmptyState, StatCard } from "@/components/ui";
import { Money } from "@/components/Money";
import { Histogram } from "@/components/Histogram";
import { TagBadge } from "@/components/TagBadge";
import { getAnalyticsData } from "@/lib/server/analytics";
import { getDisplayCurrency } from "@/lib/server/settings";

function fmtPct(p: number | null, signed = false): string {
  if (p == null) return "—";
  const sign = signed && p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

function fmtDays(d: number | null): string {
  if (d == null) return "—";
  if (d < 1) return "<1d";
  if (d < 365) return `${Math.round(d)}d`;
  const years = d / 365;
  return `${years.toFixed(1)}y`;
}

function pctColor(p: number | null): string {
  if (p == null) return "text-zinc-500";
  if (p > 0) return "text-emerald-600 dark:text-emerald-400";
  if (p < 0) return "text-rose-600 dark:text-rose-400";
  return "text-zinc-500";
}

export default async function AnalyticsPage() {
  const displayCurrency = await getDisplayCurrency();
  const data = await getAnalyticsData(displayCurrency);
  const {
    headline,
    daysHeldHistogram,
    marginHistogram,
    topWinners,
    topLosers,
    slowMovers,
    tagScorecards,
    sameItem,
  } = data;

  if (headline.sellsCount === 0 && headline.itemsInStock === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <EmptyState
          title="Not enough data yet"
          description="Log some buys and sells (or import a CSV) to unlock analytics."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Descriptive analytics over your transaction history. All amounts in {displayCurrency}.
        </p>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Realized (lifetime)">
          <Money
            amount={headline.realizedTotal}
            currency={displayCurrency}
            signed
          />
        </StatCard>
        <StatCard label="Win rate" hint={`${headline.sellsCount} sells`}>
          <span className={pctColor(headline.winRatePct - 50)}>
            {fmtPct(headline.winRatePct)}
          </span>
        </StatCard>
        <StatCard label="Avg margin">
          <span className={pctColor(headline.avgMarginPct)}>
            {fmtPct(headline.avgMarginPct, true)}
          </span>
        </StatCard>
        <StatCard label="Avg days held">
          {fmtDays(headline.avgDaysHeld)}
        </StatCard>
        <StatCard
          label="Capital tied up"
          hint={`${headline.itemsInStock} items in stock`}
        >
          <Money
            amount={headline.capitalTiedUp}
            currency={displayCurrency}
          />
        </StatCard>
        <StatCard label="On the way">
          <span className="tabular-nums">{headline.itemsOnTheWay}</span>
        </StatCard>
      </div>

      {/* Histograms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-4">
          <h2 className="font-medium mb-3">How long do items take to sell?</h2>
          <Histogram
            buckets={daysHeldHistogram}
            fillClassFor={() => "fill-sky-500/80 dark:fill-sky-400/70"}
            tooltipFor={(b) => `${b.label}: ${b.count} sells`}
            emptyText="No sells yet."
          />
          <p className="text-xs text-zinc-500 mt-2">
            Distribution of days from buy to sell across every completed sell.
          </p>
        </Card>
        <Card className="p-4">
          <h2 className="font-medium mb-3">Margin distribution</h2>
          <Histogram
            buckets={marginHistogram}
            fillClassFor={(b) => {
              if (b.min >= 0) return "fill-emerald-500/80 dark:fill-emerald-400/70";
              return "fill-rose-500/80 dark:fill-rose-400/70";
            }}
            tooltipFor={(b) => `${b.label}: ${b.count} sells`}
            emptyText="No sells yet."
          />
          <p className="text-xs text-zinc-500 mt-2">
            Margin = realized profit ÷ cost basis. Green = profit, red = loss.
          </p>
        </Card>
      </div>

      {/* Winners / losers — aggregated per item */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="font-medium">Top winning items</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Biggest net realized profit across all sells, in {displayCurrency}.
            </p>
          </div>
          {topWinners.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-500">
              No profitable items yet.
            </div>
          ) : (
            <ItemPerformanceTable
              rows={topWinners}
              displayCurrency={displayCurrency}
            />
          )}
        </Card>
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="font-medium">Top losing items</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Biggest net realized loss across all sells, in {displayCurrency}.
            </p>
          </div>
          {topLosers.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-500">
              No items with a net loss — nice.
            </div>
          ) : (
            <ItemPerformanceTable
              rows={topLosers}
              displayCurrency={displayCurrency}
            />
          )}
        </Card>
      </div>

      {/* Slow movers */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-medium">Slow movers</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Inventory held &gt; 90 days, sorted by capital tied up.
          </p>
        </div>
        {slowMovers.length === 0 ? (
          <div className="px-4 py-6 text-sm text-zinc-500">
            Nothing has been sitting longer than 90 days.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Item</th>
                  <th className="text-left font-medium px-4 py-2">Bought</th>
                  <th className="text-right font-medium px-4 py-2">Days held</th>
                  <th className="text-right font-medium px-4 py-2">Qty</th>
                  <th className="text-right font-medium px-4 py-2">
                    Cost ({displayCurrency})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {slowMovers.map((m, i) => (
                  <tr
                    key={`${m.itemId}-${i}`}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/items/${m.itemId}`}
                        className="font-medium hover:underline"
                      >
                        {m.itemName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-zinc-500">
                      {m.buyDate.toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {Math.round(m.daysHeld)}d
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {m.qty}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <Money
                        amount={m.costDisplayCents}
                        currency={displayCurrency}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Per-tag scorecard */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-medium">Per-tag scorecard</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            ROI = realized ÷ cost spent on sells with that tag. Items can carry
            multiple tags — totals may overlap.
          </p>
        </div>
        {tagScorecards.length === 0 ? (
          <div className="px-4 py-6 text-sm text-zinc-500">
            No tagged items with sells yet. Run{" "}
            <Link href="/admin" className="underline">
              Admin → Bulk auto-tag
            </Link>{" "}
            to tag your inventory.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Tag</th>
                  <th className="text-right font-medium px-4 py-2">Items</th>
                  <th className="text-right font-medium px-4 py-2">Sells</th>
                  <th className="text-right font-medium px-4 py-2">Win rate</th>
                  <th className="text-right font-medium px-4 py-2">Avg margin</th>
                  <th className="text-right font-medium px-4 py-2">Avg days held</th>
                  <th className="text-right font-medium px-4 py-2">
                    Realized ({displayCurrency})
                  </th>
                  <th className="text-right font-medium px-4 py-2">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {tagScorecards.map((t) => (
                  <tr key={t.tag} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="px-4 py-2.5">
                      <TagBadge tag={t.tag} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t.itemCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t.sellsCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={pctColor(t.winRatePct - 50)}>
                        {fmtPct(t.winRatePct)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={pctColor(t.avgMarginPct)}>
                        {fmtPct(t.avgMarginPct, true)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtDays(t.avgDaysHeld)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <Money
                        amount={t.totalRealized}
                        currency={displayCurrency}
                        signed
                      />
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums font-medium ${pctColor(
                        t.roiPct,
                      )}`}
                    >
                      {fmtPct(t.roiPct, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Same-item comparator */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-medium">Same-item comparison</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            For items you&apos;ve transacted multiple times — outcomes side-by-side
            to spot consistency or variance.
          </p>
        </div>
        {sameItem.length === 0 ? (
          <div className="px-4 py-6 text-sm text-zinc-500">
            No items with multiple lots yet.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {sameItem.map((row) => (
              <details key={row.itemId} className="px-4 py-3">
                <summary className="cursor-pointer flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 -mx-4 px-4 py-1.5 rounded">
                  <Link
                    href={`/items/${row.itemId}`}
                    className="font-medium hover:underline"
                  >
                    {row.itemName}
                  </Link>
                  <span className="text-xs text-zinc-500">
                    {row.lotCount} lot(s)
                  </span>
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th className="text-left px-2 py-1">Lot</th>
                        <th className="text-left px-2 py-1">Bought</th>
                        <th className="text-left px-2 py-1">Sold</th>
                        <th className="text-right px-2 py-1">Days</th>
                        <th className="text-right px-2 py-1">Buy</th>
                        <th className="text-right px-2 py-1">Sell</th>
                        <th className="text-right px-2 py-1">Realized</th>
                        <th className="text-right px-2 py-1">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.lots.map((l, i) => (
                        <tr
                          key={i}
                          className="border-t border-zinc-100 dark:border-zinc-800/60"
                        >
                          <td className="px-2 py-1 text-zinc-500">{l.label}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {l.buyDate.toLocaleDateString()}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap text-zinc-500">
                            {l.sellDate?.toLocaleDateString() ?? "—"}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {l.daysHeld != null ? fmtDays(l.daysHeld) : "—"}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            <Money amount={l.buyCents} currency={l.currency} />
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            <Money amount={l.sellCents ?? null} currency={l.currency} />
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            <Money
                              amount={l.realizedNativeCents ?? null}
                              currency={l.currency}
                              signed
                            />
                          </td>
                          <td
                            className={`px-2 py-1 text-right tabular-nums ${pctColor(l.marginPct)}`}
                          >
                            {fmtPct(l.marginPct, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ItemPerformanceTable({
  rows,
  displayCurrency,
}: {
  rows: Array<{
    itemId: string;
    itemName: string;
    sellsCount: number;
    unitsSold: number;
    totalRealizedDisplay: number;
    totalCostDisplay: number;
    avgMarginPct: number | null;
    avgDaysHeld: number | null;
  }>;
  displayCurrency: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
          <tr>
            <th className="text-left font-medium px-4 py-2">Item</th>
            <th
              className="text-right font-medium px-4 py-2"
              title="Total units sold (qty across all sell transactions)"
            >
              Units
            </th>
            <th className="text-right font-medium px-4 py-2">Cost</th>
            <th className="text-right font-medium px-4 py-2">Avg days</th>
            <th className="text-right font-medium px-4 py-2">ROI</th>
            <th className="text-right font-medium px-4 py-2">Realized</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr
              key={r.itemId}
              className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
            >
              <td className="px-4 py-2">
                <Link
                  href={`/items/${r.itemId}`}
                  className="font-medium hover:underline"
                >
                  {r.itemName}
                </Link>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                <span className="font-medium">{r.unitsSold}</span>
                {r.sellsCount !== r.unitsSold && (
                  <span className="text-[10px] text-zinc-500 ml-1">
                    ({r.sellsCount} sells)
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
                <Money
                  amount={r.totalCostDisplay}
                  currency={displayCurrency}
                />
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
                {fmtDays(r.avgDaysHeld)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                <span className={pctColor(r.avgMarginPct)}>
                  {fmtPct(r.avgMarginPct, true)}
                </span>
              </td>
              <td className="px-4 py-2 text-right tabular-nums font-medium">
                <Money
                  amount={r.totalRealizedDisplay}
                  currency={displayCurrency}
                  signed
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
