import { ItemLink } from "@/components/ItemDrawer";
import Link from "next/link";
import { Card } from "@/components/ui";
import { ItemThumb } from "@/components/ItemThumb";
import { Money } from "@/components/Money";
import {
  MOVER_WINDOW_DAYS,
  type PriceAnalytics,
} from "@/lib/server/price_analytics";

function pct(p: number | null, signed = false): string {
  if (p == null) return "—";
  const v = p * 100;
  return `${signed && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function pctColor(p: number | null): string {
  if (p == null) return "text-zinc-400";
  if (p > 0) return "text-emerald-600 dark:text-emerald-400";
  if (p < 0) return "text-rose-600 dark:text-rose-400";
  return "text-zinc-500";
}

/**
 * Humanise the gap between two snapshots. Sub-day spans are common right
 * after a first bulk refresh — rendering those as "over 0d" looks like a
 * bug, so they get hours (or "just now") instead.
 */
function formatSpan(days: number): string {
  if (days >= 1) return `over ${days.toFixed(0)}d`;
  const hours = days * 24;
  if (hours >= 1) return `over ${hours.toFixed(0)}h`;
  const mins = hours * 60;
  return mins >= 1 ? `over ${mins.toFixed(0)}m` : "just now";
}

/**
 * Open-position analytics — the counterpart to the realized/sell-based
 * tables above it. Everything here depends on `market_prices`, so it
 * degrades gracefully to a prompt when no prices have been fetched yet.
 */
export function PriceAnalyticsSection({
  data,
  displayCurrency,
}: {
  data: PriceAnalytics;
  displayCurrency: string;
}) {
  const {
    positions,
    unpricedCount,
    unpricedNames,
    unpricedCostBasis,
  } = data;

  if (positions.length === 0) {
    return (
      <Card className="p-6 text-sm text-zinc-500">
        <div className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          No market prices yet
        </div>
        Use <strong>Update all prices</strong> on the{" "}
        <Link href="/items" className="underline hover:no-underline">
          Items
        </Link>{" "}
        page to price your held positions from eBay. Everything in this section
        unlocks once prices exist.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {unpricedCount > 0 && (
        <div className="text-xs rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-amber-800 dark:text-amber-300">
          <strong>{unpricedCount}</strong> held item
          {unpricedCount === 1 ? " is" : "s are"} still unpriced, covering{" "}
          <Money amount={unpricedCostBasis} currency={displayCurrency} /> of
          cost. Every figure in this section is scoped to the {positions.length}{" "}
          priced position
          {positions.length === 1 ? "" : "s"} only.
          {unpricedNames.length > 0 && (
            <span className="text-amber-700/80 dark:text-amber-400/70">
              {" "}
              e.g. {unpricedNames.slice(0, 3).join(", ")}
              {unpricedNames.length > 3 ? "…" : ""}
            </span>
          )}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="font-medium">All open positions</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Every held item with a market price, by market value. The dashboard
            shows the largest eight and the biggest recent moves.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Item</th>
                <th className="px-4 py-2 text-right font-medium">Held</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">Market</th>
                <th className="px-4 py-2 text-right font-medium">Unrealized</th>
                <th className="px-4 py-2 text-right font-medium">Return</th>
                <th
                  className="px-4 py-2 text-right font-medium"
                  title={`Change vs up to ${MOVER_WINDOW_DAYS} days ago`}
                >
                  Trend
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {positions.map((p) => (
                <tr
                  key={p.itemId}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <ItemThumb
                        imageUrl={p.imageUrl}
                        name={p.name}
                        size={28}
                      />
                      <ItemLink
                        itemId={p.itemId}
                        className="font-medium hover:underline truncate"
                      >
                        {p.name}
                      </ItemLink>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {p.quantity}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">
                    <Money
                      amount={p.costBasisDisplay}
                      currency={displayCurrency}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <Money
                      amount={p.marketValueDisplay}
                      currency={displayCurrency}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <Money
                      amount={p.unrealizedDisplay}
                      currency={displayCurrency}
                      signed
                    />
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums font-medium ${pctColor(p.unrealizedPct)}`}
                  >
                    {pct(p.unrealizedPct, true)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums text-xs ${pctColor(p.change?.changePct ?? null)}`}
                    title={
                      p.change
                        ? `${pct(p.change.changePct, true)} ${formatSpan(p.change.spanDays)} (${p.snapshotCount} snapshots)`
                        : `${p.snapshotCount} snapshot(s) — need 2+ for a trend`
                    }
                  >
                    {p.change ? pct(p.change.changePct, true) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
