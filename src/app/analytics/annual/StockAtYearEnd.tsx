import Link from "next/link";
import { Money } from "@/components/Money";
import type { StockReport } from "@/lib/server/stock_on";

const dayLabel = (d: Date) =>
  d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * How your stock moved each year: what you started with, what you bought, the
 * cost of what left, and what you ended with, at cost and at market value.
 */
export function StockAtYearEnd({
  report,
  currency,
}: {
  report: StockReport;
  currency: string;
}) {
  const rows = report.years.filter(
    (y) => y.open + y.bought + y.out + y.close > 0,
  );
  if (rows.length === 0) return null;
  const withGap = rows.some((y) => Math.abs(y.gap) > rows.length);
  const unpriced = rows.some((y) => y.heldItems > 0 && y.pricedItems < y.heldItems);
  return (
    <section className="rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-card p-4">
      <h2 className="font-medium text-sm">Stock at year end</h2>
      <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
        What you started each year with, plus what you bought, minus the cost of
        what left (sold, gifted, lost or opened), is what you ended with. Cost
        uses your cost method, like everything else.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="py-2 pr-2 text-left font-medium">Year</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">Started with</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">Bought</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">Left</th>
              <th className="px-2 py-2 text-right font-medium">Ended with</th>
              <th className="pl-2 py-2 text-right font-medium">Market value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((y) => (
              <tr key={y.year}>
                <td className="py-2 pr-2">
                  <Link
                    href={`/analytics/stock?date=${y.closedOn.toISOString().slice(0, 10)}`}
                    className="font-medium hover:underline"
                    title="See every item held on this day"
                  >
                    {y.year}
                  </Link>
                  <div className="text-[11px] text-zinc-500">
                    {y.complete ? `to ${dayLabel(y.closedOn)}` : "to date"}
                    {` · ${y.closeUnits} units`}
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                  <Money amount={y.open} currency={currency} />
                </td>
                <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                  <Money amount={y.bought} currency={currency} />
                </td>
                <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                  <Money amount={y.out} currency={currency} />
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-medium">
                  <Money amount={y.close} currency={currency} />
                </td>
                <td className="pl-2 py-2 text-right tabular-nums">
                  {y.pricedItems === 0 ? (
                    <span className="text-zinc-400">—</span>
                  ) : (
                    <>
                      <Money amount={y.value} currency={currency} />
                      {y.pricedItems < y.heldItems && (
                        <div className="text-[11px] text-zinc-500">
                          {`${y.pricedItems} of ${y.heldItems} items`}
                        </div>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
        {unpriced
          ? `Market value counts only items that had a price on that day; the rest are left out, not guessed${report.firstPriceDay ? `. Price history starts ${dayLabel(new Date(`${report.firstPriceDay}T00:00:00Z`))}, so earlier year ends have none` : ""}. `
          : ""}
        {report.inTransit.units > 0
          ? `${report.inTransit.units} units you have paid for but not received yet are not stock yet, so they are not counted. `
          : ""}
        {withGap ? "Some rounding from currency conversion shows up in the totals. " : ""}
        Click a year to see every item held on that day.
      </p>
    </section>
  );
}
