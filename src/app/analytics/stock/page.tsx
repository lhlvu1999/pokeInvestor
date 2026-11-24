export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card, StatCard } from "@/components/ui";
import { Money } from "@/components/Money";
import {
  activeYears,
  dayOf,
  endOfDay,
  isDay,
  yearEnd,
} from "@/lib/calc/stock_on";
import { getDisplayCurrency } from "@/lib/server/settings";
import { getStockOn } from "@/lib/server/stock_on";
import { db } from "@/db/client";
import { transactions } from "@/db/schema";

const dayLabel = (d: Date) =>
  d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** Everything you held at the end of a chosen day, with cost and value. */
export default async function StockOnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).date;
  const asked = Array.isArray(raw) ? raw[0] : raw;
  const now = new Date();
  const today = dayOf(now);
  // A day in the future is just "today"; a bad value falls back to today too.
  const day = asked && isDay(asked) && asked <= today ? asked : today;
  const currency = await getDisplayCurrency();
  const [lines, txs] = await Promise.all([
    getStockOn(endOfDay(day), currency),
    db.select({ occurredAt: transactions.occurredAt }).from(transactions),
  ]);
  const years = activeYears(txs, now).filter((y) => y < now.getUTCFullYear());

  const priced = lines.filter((l) => l.valueShown != null);
  const unpriced = lines.filter((l) => l.valueShown == null);
  const cost = lines.reduce((n, l) => n + (l.costShown ?? 0), 0);
  const value = priced.reduce((n, l) => n + (l.valueShown ?? 0), 0);
  const pricedCost = priced.reduce((n, l) => n + (l.costShown ?? 0), 0);
  const stale = priced.filter((l) => l.stale).length;
  const units = lines.reduce((n, l) => n + l.qty, 0);
  const unconverted = lines.filter((l) => l.costShown == null).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stock on a day</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          Everything you held at the end of a day, worked out from the buys and
          sells up to then, with its cost and its value at the latest price
          recorded by then. Days follow UTC dates.
        </p>
      </div>

      <Card className="p-4">
        <form action="/analytics/stock" method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Day
            <input
              type="date"
              name="date"
              defaultValue={day}
              max={today}
              className="h-10 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </label>
          <button
            type="submit"
            className="h-10 px-4 rounded-md text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Show
          </button>
          <span className="flex flex-wrap gap-2 text-xs">
            <Link href="/analytics/stock" className="rounded-full border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              Today
            </Link>
            {years.map((y) => (
              <Link
                key={y}
                href={`/analytics/stock?date=${dayOf(yearEnd(y))}`}
                className="rounded-full border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {`End of ${y}`}
              </Link>
            ))}
          </span>
        </form>
        {asked && asked !== day && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            {`That day isn't available, so this shows ${dayLabel(new Date(`${day}T00:00:00Z`))}.`}
          </p>
        )}
      </Card>

      {lines.length === 0 ? (
        <Card className="p-6 text-sm text-zinc-500">
          {`You held nothing at the end of ${dayLabel(new Date(`${day}T00:00:00Z`))}.`}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Held" hint={`${lines.length} items`}>
              {units.toLocaleString()} units
            </StatCard>
            <StatCard label="Cost" hint="What those units cost you">
              <Money amount={cost} currency={currency} />
            </StatCard>
            <StatCard
              label="Market value"
              hint={`${priced.length} of ${lines.length} items had a price`}
            >
              {priced.length === 0 ? "—" : <Money amount={value} currency={currency} />}
            </StatCard>
            <StatCard
              label="Priced items: change"
              hint="Value less the cost of the priced items"
            >
              {priced.length === 0 ? (
                "—"
              ) : (
                <Money amount={value - pricedCost} currency={currency} signed />
              )}
            </StatCard>
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium text-sm">{`Held on ${dayLabel(new Date(`${day}T00:00:00Z`))}`}</h2>
              <a
                href={`/api/export/stock?date=${day}`}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
              >
                Download (CSV)
              </a>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-2 pr-2 text-left font-medium">Item</th>
                    <th className="px-2 py-2 text-right font-medium">Units</th>
                    <th className="px-2 py-2 text-right font-medium">Cost</th>
                    <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">Price</th>
                    <th className="pl-2 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {lines.map((l) => (
                    <tr key={l.itemId}>
                      <td className="py-2 pr-2 min-w-0">
                        <Link href={`/items/${l.itemId}`} className="hover:underline">
                          {l.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.qty}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <Money amount={l.costShown} currency={currency} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                        {l.priceCents == null ? (
                          <span className="text-zinc-400">—</span>
                        ) : (
                          <>
                            <Money amount={l.priceCents} currency={l.currency} />
                            {l.stale && l.priceAt && (
                              <div className="text-[11px] text-amber-700 dark:text-amber-400">
                                {`from ${dayLabel(l.priceAt)}`}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="pl-2 py-2 text-right tabular-nums">
                        {l.valueShown == null ? (
                          <span className="text-zinc-400">no price</span>
                        ) : (
                          <Money amount={l.valueShown} currency={currency} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
              {unpriced.length > 0
                ? `${unpriced.length} item${unpriced.length === 1 ? " has" : "s have"} no price recorded by that day (${unpriced.length === lines.length ? "price history doesn't go back that far" : "never priced"}); they are in Cost but not in Market value. `
                : ""}
              {stale > 0
                ? `${stale} price${stale === 1 ? " was" : "s were"} more than 30 days old on that day (marked "from"). `
                : ""}
              {unconverted > 0
                ? `${unconverted} item${unconverted === 1 ? "" : "s"} could not be converted to ${currency} (no exchange rate) and ${unconverted === 1 ? "is" : "are"} left out of the totals. `
                : ""}
              Foreign-currency amounts use today&apos;s exchange rate; the download keeps each item&apos;s own currency.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
