import { Card } from "@/components/ui";
import { MIN_DAYS, type ReturnReport } from "@/lib/calc/annualized";
import { pct, tone } from "@/lib/calc/format_delta";
import { formatCompactAmount } from "@/lib/currency";

/** "5 weeks" / "14 months" / "2.1 years": how much history the rate rests on. */
function span(days: number): string {
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const UNAVAILABLE: Record<"no_root" | "ambiguous" | "invalid", string> = {
  ambiguous:
    "Your money moved in and out in a pattern that fits more than one yearly rate, so any single number would be a guess.",
  no_root:
    "No yearly rate fits these flows (for example, nearly everything is lost, or money only went one way).",
  invalid: "There isn't enough activity yet to work out a yearly rate.",
};

/**
 * "What yearly rate did my money earn?" The honest version: it holds back
 * until there are 90 days of history, says when the figure is only a
 * projection (under a year), and says how much of today's value isn't a
 * market price. Server-rendered, no client JavaScript.
 */
export function AnnualizedCard({
  report,
  currency,
  atCostValue,
  skipped,
}: {
  report: ReturnReport;
  currency: string;
  /** Part of today's value counted at cost rather than a market price. */
  atCostValue: number;
  /** Transactions left out for lack of an exchange rate. */
  skipped: number;
}) {
  if (report.status === "none") return null;

  const title = (
    <h2 className="font-medium text-sm">
      Annualized return{" "}
      <span className="text-xs text-zinc-500 font-normal">whole portfolio</span>
    </h2>
  );

  if (report.status === "too_early") {
    const pctDone = Math.min(100, Math.round((report.days / MIN_DAYS) * 100));
    return (
      <Card className="p-4">
        {title}
        <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          Shown from{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {dateLabel(report.unlocksAt)}
          </span>
          .
        </div>
        <div
          className="mt-2 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={MIN_DAYS}
          aria-valuenow={report.days}
          aria-label="History needed for an annualized return"
        >
          <div
            className="h-full bg-zinc-900 dark:bg-zinc-100"
            style={{ width: `${pctDone}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
          Needs {MIN_DAYS} days of history. You have {report.days}. A yearly
          rate worked out from a few weeks mostly measures luck, so it stays
          hidden until there is enough to mean something.
        </p>
      </Card>
    );
  }

  if (report.status === "unavailable") {
    return (
      <Card className="p-4">
        {title}
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          {UNAVAILABLE[report.reason]}
        </p>
      </Card>
    );
  }

  // A rate this large is arithmetic on a short, lucky stretch, not a
  // forecast. Show it capped so nobody reads it as one.
  const CAP = 10;
  const capped = report.annualized > CAP;

  return (
    <Card className="p-4">
      {title}

      <div
        className={`mt-3 text-3xl font-semibold tabular-nums tracking-tight leading-none ${tone(report.annualized)}`}
      >
        {capped ? "more than +1,000%" : pct(report.annualized)}
        <span className="ml-1.5 text-sm font-normal text-zinc-500">a year</span>
      </div>
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
        Over {span(report.days)}, each 100 you spent has become{" "}
        <span className="tabular-nums font-medium">
          {(report.multiple * 100).toFixed(0)}
        </span>{" "}
        in sales plus stock on hand.
      </p>

      {report.extrapolated && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
          {`Only ${span(report.days)} of history, so this projects that pace forward; it is not a track record. It firms up after a full year.`}
        </p>
      )}
      {atCostValue > 0 && (
        <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
          {`${formatCompactAmount(atCostValue, currency)} of today’s stock is unpriced or still on its way, so it’s counted at what you paid. That pulls the rate toward zero, in either direction.`}
        </p>
      )}
      {skipped > 0 && (
        <p className="mt-2 text-[11px] text-zinc-500">
          {skipped} transaction{skipped === 1 ? "" : "s"} in another currency
          left out (no exchange rate).
        </p>
      )}

      <details className="mt-3 text-[11px] text-zinc-500">
        <summary className="cursor-pointer hover:underline">
          How this is worked out
        </summary>
        <p className="mt-1.5 leading-relaxed">
          It is a money-weighted return (the same as Excel&apos;s XIRR): the
          single yearly rate that turns each purchase, on the day you made it,
          into your sales on the days they came in, plus what you still hold
          today. Money that sat in stock for longer counts for more. Gifted,
          lost and opened units are sales for zero, so they stay in as the loss
          they are. Prices are market estimates, not sale offers.
        </p>
      </details>
    </Card>
  );
}
