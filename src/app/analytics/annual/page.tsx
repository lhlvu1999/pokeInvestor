export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card, StatCard } from "@/components/ui";
import { Money } from "@/components/Money";
import {
  linesOfYear,
  margin,
  parseYear,
  summarizeYears,
  winRate,
} from "@/lib/calc/annual";
import { displayExitReason, EXIT_REASON_LABELS } from "@/lib/calc/exit_reason";
import { getSaleLines } from "@/lib/server/annual";
import { getDataIssues } from "@/lib/server/data_checks";
import { countByKind } from "@/lib/calc/data_checks";
import { FreeSales } from "./FreeSales";
import { StockAtYearEnd } from "./StockAtYearEnd";
import { getStockReport } from "@/lib/server/stock_on";
import { getCostMethod, getDisplayCurrency } from "@/lib/server/settings";

const pct = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;
const dateLabel = (d: Date) =>
  d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/**
 * What you sold each year and what it earned, with a sales ledger you can
 * download for a tax return or a spreadsheet.
 */
export default async function AnnualPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currency = await getDisplayCurrency();
  const [lines, method, issues, stock] = await Promise.all([
    getSaleLines(currency),
    getCostMethod(),
    getDataIssues(),
    getStockReport(currency),
  ]);
  const freeSales = countByKind(issues).free_sale;
  const freeList = issues.filter((f) => f.kind === "free_sale");
  const otherIssues = issues.filter((f) => f.kind !== "free_sale");
  const years = summarizeYears(lines);

  if (years.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight">Yearly report</h1>
        <Card className="p-6 text-sm text-zinc-500">
          Nothing has been sold yet. Once you log a sale it shows up here.
        </Card>
      </div>
    );
  }

  const chosen =
    parseYear(
      (await searchParams).year,
      years.map((y) => y.year),
    ) ?? years[0].year;
  const sel = years.find((y) => y.year === chosen)!;
  const rows = linesOfYear(lines, chosen);
  const unconverted = years.reduce((n, y) => n + y.unconverted, 0);
  const approx = years.reduce((n, y) => n + y.approx, 0);
  const foreign = new Set(lines.map((l) => l.currency));
  foreign.delete(currency);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Yearly report</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          {`What you sold each year and what it earned, in ${currency}. Cost is worked out with your ${method === "average" ? "average-cost" : "oldest-first"} method, the same as everywhere else, so the years add up to your lifetime realized profit.`}
        </p>
      </div>

      {issues.length > 0 && (
        <Card className="p-4" id="check">
          <h2 className="font-medium text-sm">
            {`${issues.length} ${issues.length === 1 ? "entry" : "entries"} worth a second look`}
          </h2>
          <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
            {freeSales > 0
              ? `${freeSales} ${freeSales === 1 ? "sale was" : "sales were"} logged for nothing without saying why. They count as losing sales, which pulls the win rate and margin down. The profit total is the same either way.`
              : "These look like possible slips. Nothing here changes your profit total."}
          </p>
          {freeList.length > 0 && (
            <FreeSales
              sales={freeList.map((f) => ({
                txId: f.txId,
                itemName: f.itemName,
                quantity: f.quantity,
                date: f.occurredAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                }),
              }))}
            />
          )}
          <ul className="mt-2 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
            {otherIssues.map((f) => (
              <li
                key={`${f.kind}-${f.txId}`}
                className="py-2 flex items-start justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="font-medium">{f.itemName}</span>{" "}
                  <span className="text-xs text-zinc-500">
                    {`${f.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · ${f.title}`}
                  </span>
                  <span className="block text-[11px] text-zinc-500 leading-relaxed max-w-prose">
                    {f.advice}
                  </span>
                </span>
                <Link
                  href={`/transactions/${f.txId}/edit`}
                  className="shrink-0 text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                >
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-2 text-left font-medium">Year</th>
                <th className="px-2 py-2 text-right font-medium">Sales</th>
                <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">
                  Brought in
                </th>
                <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">
                  Cost
                </th>
                <th className="px-2 py-2 text-right font-medium">Profit</th>
                <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">
                  Write-offs
                </th>
                <th className="pl-2 py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {years.map((y) => (
                <tr
                  key={y.year}
                  className={
                    y.year === chosen ? "bg-zinc-50 dark:bg-zinc-900" : ""
                  }
                >
                  <td className="py-2 pr-2 font-medium">
                    <Link
                      href={`/analytics/annual?year=${y.year}`}
                      scroll={false}
                      className="hover:underline"
                    >
                      {y.year}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {y.sales}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                    <Money amount={y.proceeds} currency={currency} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                    <Money amount={y.cost} currency={currency} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <Money amount={y.profit} currency={currency} signed />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                    {y.writeOffUnits === 0 ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <Money amount={y.writeOffs} currency={currency} signed />
                    )}
                  </td>
                  <td className="pl-2 py-2 text-right tabular-nums font-medium">
                    <Money amount={y.net} currency={currency} signed />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
          {`Years follow UTC dates, so a sale logged just after midnight in your time zone can count toward the day before. Write-offs are gifts, losses and packs you opened: they count in Net, but not in Sales or the win rate.`}
          {foreign.size > 0
            ? ` Sales made in ${[...foreign].join(", ")} are converted at the exchange rate on the day of the sale, and what they cost at the rate on the day each unit was bought, so the profit includes any currency gain or loss in between. Because of that, this year's total can differ from the Analytics page, which uses today's rate for everything. The download keeps each sale in the currency it happened in.`
            : ""}
          {approx > 0
            ? ` ${approx} line${approx === 1 ? "" : "s"} used today's rate for some part, because no rate could be found for that day (rates start in March 2024, and a day that could not be reached is tried again later).`
            : ""}
          {unconverted > 0
            ? ` ${unconverted} line${unconverted === 1 ? "" : "s"} could not be converted (no exchange rate) and ${unconverted === 1 ? "is" : "are"} left out of the totals; they are in the download.`
            : ""}
        </p>
      </Card>

      <StockAtYearEnd report={stock} currency={currency} />

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h2 className="font-medium">{chosen}</h2>
          <span className="flex gap-3 text-xs">
            <a
              href={`/api/export/sales?year=${chosen}`}
              className="font-medium text-sky-700 dark:text-sky-400 hover:underline"
            >
              {`Download ${chosen} sales (CSV)`}
            </a>
            {years.length > 1 && (
              <a
                href="/api/export/sales"
                className="text-zinc-500 hover:underline"
              >
                All years
              </a>
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Profit on sales"
            hint={`${sel.sales} sale${sel.sales === 1 ? "" : "s"}, ${sel.units} unit${sel.units === 1 ? "" : "s"}`}
          >
            <Money amount={sel.profit} currency={currency} signed />
          </StatCard>
          <StatCard
            label="Margin"
            hint="Profit as a share of what those units cost"
          >
            {pct(margin(sel))}
          </StatCard>
          <StatCard
            label="Win rate"
            hint={`${sel.winners} made money, ${sel.losers} lost${sel.sales - sel.winners - sel.losers > 0 ? `, ${sel.sales - sel.winners - sel.losers} broke even` : ""}`}
          >
            {pct(winRate(sel))}
          </StatCard>
          <StatCard
            label="Net after write-offs"
            hint={
              sel.writeOffUnits > 0
                ? `${sel.writeOffUnits} unit${sel.writeOffUnits === 1 ? "" : "s"} gifted, lost or opened`
                : "No write-offs this year"
            }
          >
            <Money amount={sel.net} currency={currency} signed />
          </StatCard>
        </div>
      </div>

      <Card className="p-4">
        <h2 className="font-medium text-sm">Sales in {chosen}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-2 text-left font-medium">Date</th>
                <th className="px-2 py-2 text-left font-medium">Item</th>
                <th className="px-2 py-2 text-right font-medium">Qty</th>
                <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">
                  Brought in
                </th>
                <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">
                  Cost
                </th>
                <th className="pl-2 py-2 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((l) => (
                <tr key={l.txId}>
                  <td className="py-2 pr-2 whitespace-nowrap text-zinc-500">
                    {dateLabel(l.soldOn)}
                  </td>
                  <td className="px-2 py-2 min-w-0">
                    <Link
                      href={`/items/${l.itemId}`}
                      className="hover:underline"
                    >
                      {l.itemName}
                    </Link>
                    {l.reason !== "sold" && (
                      <span className="ml-2 rounded-full border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        {EXIT_REASON_LABELS[displayExitReason(l.reason)]}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.qty}</td>
                  <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                    <Money amount={l.shown?.proceeds} currency={currency} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                    <Money amount={l.shown?.cost} currency={currency} />
                  </td>
                  <td className="pl-2 py-2 text-right tabular-nums">
                    <Money
                      amount={l.shown?.realized}
                      currency={currency}
                      signed
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500 max-w-prose leading-relaxed">
          This is a record of what happened, worked out from the transactions
          you logged. It is not tax advice, and what counts as taxable income or
          an allowed cost differs by country, so check it with whoever files
          your return.
        </p>
      </Card>
    </div>
  );
}
