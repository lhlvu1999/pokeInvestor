import Link from "next/link";
import { Card } from "@/components/ui";
import { tone } from "@/lib/calc/format_delta";
import { usdCents } from "@/lib/usd";
import {
  BASES,
  BASIS_LABELS,
  UNAVAILABLE_TEXT,
  durationLabel,
  rateText,
  type Basis,
  type ReturnResult,
} from "@/lib/calc/position_return";
import { MIN_DAYS } from "@/lib/calc/annualized";
import { excessText, type PmeResult } from "@/lib/calc/pme";
import { formatCompactAmount } from "@/lib/currency";

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** A short cell for the comparison list and the Returns table. */
export function RateCell({ result }: { result: ReturnResult }) {
  if (result.status === "ok") {
    return (
      <span className={`tabular-nums ${tone(result.annualized)}`}>
        {rateText(result.annualized)}
      </span>
    );
  }
  if (result.status === "too_early") {
    return (
      <span className="text-zinc-400 text-xs">
        {`in ${result.daysToGo} ${result.daysToGo === 1 ? "day" : "days"}`}
      </span>
    );
  }
  return <span className="text-zinc-400">—</span>;
}

/**
 * One position's annualized return, from a choice of starting point. "My
 * purchases" is what you earned; the others are what the product's market
 * price did from that starting point, the yardstick for whether your entry
 * price helped or hurt.
 */
export function ReturnBasisCard({
  results,
  basis,
  hrefs,
  currency,
  vsIndex,
  benchLabel,
}: {
  vsIndex?: PmeResult;
  /** Name of the index `vsIndex` was measured against. */
  benchLabel?: string | null;
  results: Record<Basis, ReturnResult>;
  basis: Basis;
  /** Where each basis chip goes. */
  hrefs: Record<Basis, string>;
  currency: string;
}) {
  const r = results[basis];

  return (
    <Card className="p-4">
      <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        Annualized return
      </h2>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500 w-full sm:w-auto">
          From
        </span>
        {BASES.map((b) => (
          <Link
            key={b}
            href={hrefs[b]}
            scroll={false}
            aria-current={b === basis ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-xs ${
              b === basis
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {BASIS_LABELS[b]}
          </Link>
        ))}
      </div>

      {r.status === "ok" && (
        <div className="mt-3">
          <div
            className={`text-3xl font-semibold tabular-nums tracking-tight leading-none ${tone(r.annualized)}`}
          >
            {rateText(r.annualized)}
            <span className="ml-1.5 text-sm font-normal text-zinc-500">
              a year
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-prose">
            {r.prices
              ? `The market price went from ${usdCents(r.prices.entry.cents)} on ${dateLabel(r.prices.entry.day)} to ${usdCents(r.prices.now.cents)} on ${dateLabel(r.prices.now.day)}: ${r.change > 0 ? "+" : r.change < 0 ? "−" : ""}${Math.abs(r.change * 100).toFixed(1)}% over ${durationLabel(r.days)}.`
              : `Over ${durationLabel(r.days)} from your first buy on ${dateLabel(r.entryDay)}, each 100 you spent has become ${(100 * (1 + r.change)).toFixed(0)} in sales plus stock on hand.`}
          </p>
          {r.extrapolated && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed max-w-prose">
              {`Only ${durationLabel(r.days)} of history, so this projects that pace forward; it is not a track record.`}
            </p>
          )}
        </div>
      )}
      {r.status === "too_early" && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300 max-w-prose leading-relaxed">
          {`Needs ${MIN_DAYS} days behind it; this has ${r.days}. It appears in ${r.daysToGo} ${r.daysToGo === 1 ? "day" : "days"}. A yearly rate from a few weeks mostly measures luck.`}
        </p>
      )}
      {r.status === "unavailable" && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300 max-w-prose leading-relaxed">
          {UNAVAILABLE_TEXT[r.reason]}
        </p>
      )}

      {basis === "purchase" &&
        vsIndex?.status === "ok" &&
        vsIndex.indexRate != null &&
        r.status === "ok" && (
          <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-prose">
            {`Same money in ${benchLabel ?? "the index"}: ${rateText(vsIndex.indexRate)} a year, so you're ${vsIndex.excess != null ? excessText(vsIndex.excess) : "compared"}. That is ${vsIndex.valueDiff >= 0 ? "+" : "−"}${formatCompactAmount(Math.abs(Math.round(vsIndex.valueDiff)), currency || "VND")} against what the index would have left you.`}{" "}
            <a
              href="/analytics/vs-market"
              className="underline hover:no-underline"
            >
              Whole stock
            </a>
          </p>
        )}

      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-3 text-sm">
        {BASES.map((b) => (
          <div key={b} className={b === basis ? "" : "opacity-80"}>
            <dt className="text-[11px] text-zinc-500">{BASIS_LABELS[b]}</dt>
            <dd className="font-medium">
              <RateCell result={results[b]} />
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
        {basis === "purchase"
          ? `Your buys and sales of this item in ${currency || "its currency"}, with what you still hold counted at today's market price (at cost where it has none, and for stock still on its way). It is the yearly rate that turns each purchase, on its day, into your sales plus what's left.`
          : "This is the product's own price path, not what you earned. Set it beside “My purchases” to see whether your entry price helped or hurt. Launch price is the market price on release day (there is no MSRP in the data)."}
      </p>
    </Card>
  );
}
