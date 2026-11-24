export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card } from "@/components/ui";
import { tone } from "@/lib/calc/format_delta";
import {
  BENCH_MODE_LABELS,
  BENCH_MODES,
  parseBenchMode,
  type BenchMode,
} from "@/lib/calc/benchmark";
import {
  PME_UNAVAILABLE_TEXT,
  excessText,
  type PmeResult,
} from "@/lib/calc/pme";
import { durationLabel, rateText } from "@/lib/calc/position_return";
import { formatAmount, formatCompactAmount } from "@/lib/currency";
import {
  getStockVsMarket,
  type PositionRow,
} from "@/lib/server/position_returns";
import { getDisplayCurrency } from "@/lib/server/settings";

const href = (m: BenchMode) =>
  m === "match" ? "/analytics/vs-market" : `/analytics/vs-market?bench=${m}`;

const signedMoney = (n: number, currency: string) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatCompactAmount(Math.abs(n), currency)}`;

type Ok = Extract<PmeResult, { status: "ok" }>;
const okRows = (rows: PositionRow[]) =>
  rows.filter((r): r is PositionRow & { vsIndex: Ok } => r.vsIndex.status === "ok");

/**
 * How your stock has done against the market: the same money, put into the
 * index instead, on the days you actually bought and sold.
 */
export default async function VsMarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const mode = parseBenchMode((await searchParams).bench);
  const currency = await getDisplayCurrency();
  const data = await getStockVsMarket(new Date(), currency, mode);
  const t = data.total;

  const scored = okRows(data.rows);
  const helped = [...scored]
    .filter((r) => r.vsIndex.valueDiff > 0)
    .sort((a, b) => b.vsIndex.valueDiff - a.vsIndex.valueDiff)
    .slice(0, 10);
  const hurt = [...scored]
    .filter((r) => r.vsIndex.valueDiff < 0)
    .sort((a, b) => a.vsIndex.valueDiff - b.vsIndex.valueDiff)
    .slice(0, 10);
  const pending = data.rows.filter((r) => r.vsIndex.status === "too_early").length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Your stock vs the market
        </h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          How much of your result is you, and how much is the market. Every buy
          is treated as buying the index that day, every sale as selling it, and
          what is left as worth today&apos;s index level. It describes the past;
          it is not a forecast.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500 w-full sm:w-auto sm:mr-2">
            Compare with
          </span>
          {BENCH_MODES.map((m) => (
            <Link
              key={m}
              href={href(m)}
              scroll={false}
              aria-current={m === mode ? "true" : undefined}
              className={`rounded-full border px-3 py-1 text-xs ${
                m === mode
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {BENCH_MODE_LABELS[m]}
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-500 leading-relaxed max-w-prose">
          {mode === "match"
            ? "Each position is compared with the index for its own kind of product (boxes, trainer boxes, bundles, packs) and language."
            : "Every position is compared with the index of all sealed products in its language."}
          {data.matchedShare != null &&
            ` ${Math.round(data.matchedShare * 100)}% of what you spent had an index for its own kind; the rest (items not linked to the catalogue, and kinds without an index) is compared with all sealed products in English, a rough yardstick.`}
        </p>
      </Card>

      <Summary total={t} currency={currency} />

      {data.skipped > 0 && (
        <p className="text-[11px] text-zinc-500">
          {data.skipped} buy or sell in another currency left out (no exchange
          rate).
        </p>
      )}

      {scored.length > 0 && (
        <>
          <PositionTable
            title="What helped most"
            note="The positions where you ended up furthest ahead of the same money in the index."
            rows={helped}
            mode={mode}
            currency={currency}
          />
          <PositionTable
            title="What hurt most"
            note="The positions where you ended up furthest behind it."
            rows={hurt}
            mode={mode}
            currency={currency}
          />
        </>
      )}
      <p className="text-[11px] text-zinc-500 leading-relaxed max-w-prose">
        {`${scored.length} positions compared`}
        {pending > 0 ? `, ${pending} under 90 days old and left out` : ""}.
        A dash means no single yearly rate fits those flows (for example when
        you sold more than the same money would have held in the index); the
        money difference is still right. The index tracks the typical product,
        so it is a yardstick for how the market moved, not a strategy you could
        have bought. See{" "}
        <Link href="/catalog/insights" className="underline hover:no-underline">
          Set insights
        </Link>{" "}
        for how the index is built.
      </p>
    </div>
  );
}

function Summary({ total, currency }: { total: PmeResult; currency: string }) {
  if (total.status === "too_early") {
    return (
      <Card className="p-4 text-sm text-zinc-600 dark:text-zinc-300">
        {`Needs 90 days of history; there are ${total.days}. This appears in ${total.daysToGo} days.`}
      </Card>
    );
  }
  if (total.status === "unavailable") {
    return (
      <Card className="p-4 text-sm text-zinc-600 dark:text-zinc-300">
        {PME_UNAVAILABLE_TEXT[total.reason]}
      </Card>
    );
  }
  const rate = (r: number | null) => (r == null ? "—" : rateText(r));
  return (
    <Card className="p-4">
      <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        Whole stock · {durationLabel(total.days)}
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-4 max-w-md">
        <div>
          <div className="text-xs text-zinc-500">You</div>
          <div
            className={`text-3xl font-semibold tabular-nums tracking-tight ${total.yourRate != null ? tone(total.yourRate) : ""}`}
          >
            {rate(total.yourRate)}
          </div>
          <div className="text-[11px] text-zinc-500">a year</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Same money in the index</div>
          <div
            className={`text-3xl font-semibold tabular-nums tracking-tight ${total.indexRate != null ? tone(total.indexRate) : ""}`}
          >
            {rate(total.indexRate)}
          </div>
          <div className="text-[11px] text-zinc-500">a year</div>
        </div>
      </div>
      {total.excess != null && (
        <p className="mt-3 text-sm font-medium">{excessText(total.excess)}</p>
      )}
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-prose">
        {`If every buy had gone into the index instead, and every sale come out of it, you would hold ${formatAmount(Math.max(0, Math.round(total.indexValue)), currency)} today. You hold ${formatAmount(Math.round(total.yourValue), currency)}: ${signedMoney(Math.round(total.valueDiff), currency)} ${total.valueDiff >= 0 ? "more" : "less"} than the index.`}
      </p>
      {total.extrapolated && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 max-w-prose">
          {`Only ${durationLabel(total.days)} of history, so the yearly rates are projections.`}
        </p>
      )}
    </Card>
  );
}

function PositionTable({
  title,
  note,
  rows,
  mode,
  currency,
}: {
  title: string;
  note: string;
  rows: Array<PositionRow & { vsIndex: Ok }>;
  mode: BenchMode;
  currency: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="overflow-x-auto">
      <div className="px-3 sm:px-4 pt-3">
        <h2 className="font-medium">{title}</h2>
        <p className="text-xs text-zinc-500">{note}</p>
      </div>
      <table className="mt-2 w-full text-xs sm:text-sm">
        <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-3 sm:px-4 py-2 text-left font-medium">Item</th>
            <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
              vs index
            </th>
            <th className="px-1.5 sm:px-3 py-2 text-right font-medium hidden sm:table-cell">
              You
            </th>
            <th className="px-1.5 sm:px-3 py-2 text-right font-medium hidden sm:table-cell">
              Index
            </th>
            <th className="px-3 py-2 text-left font-medium hidden md:table-cell">
              Compared with
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((r) => {
            const v = r.vsIndex;
            return (
              <tr key={r.itemId}>
                <td className="px-3 sm:px-4 py-2 min-w-0">
                  <Link
                    href={`/items/${r.itemId}`}
                    className="font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="text-[11px] text-zinc-500">
                    {r.held > 0 ? `${r.held} held` : "sold out"}
                  </div>
                </td>
                <td
                  className={`px-1.5 sm:px-3 py-2 text-right tabular-nums font-medium ${tone(v.valueDiff)}`}
                >
                  {signedMoney(
                    Math.round(v.valueDiff),
                    r.currency || currency,
                  )}
                </td>
                <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums hidden sm:table-cell">
                  {v.yourRate == null ? "—" : rateText(v.yourRate)}
                </td>
                <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums hidden sm:table-cell text-zinc-500">
                  {v.indexRate == null ? "—" : rateText(v.indexRate)}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500 hidden md:table-cell">
                  {r.benchLabel ?? "—"}
                  {mode === "match" && r.bench?.metric === "sealed_all"
                    ? " · fallback"
                    : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
