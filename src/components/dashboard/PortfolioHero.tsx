import Link from "next/link";
import { Card } from "@/components/ui";
import { Money } from "@/components/Money";
import { PortfolioValueChart } from "@/components/PortfolioValueChart";
import { formatCompactAmount } from "@/lib/currency";
import type { PortfolioSummary } from "@/lib/calc/portfolio";
import { ageInHours, formatAge } from "@/lib/calc/relative_time";
import { STALE_PRICE_HOURS } from "@/lib/calc/attention";
import type { PortfolioValuePoint } from "@/lib/server/portfolio";

/**
 * The answer to "how am I doing?" in one glance: a single headline number,
 * whether it's up or down and by how much, the trend behind it, and the
 * three supporting figures — in that order of importance.
 *
 * The headline is market value of PRICED holdings, and the gain beside it
 * is measured against the cost of those same items. Comparing it with the
 * cost of everything held would count unpriced items as a loss. The note
 * at the bottom says how many items aren't covered.
 */
export function PortfolioHero({
  summary,
  currency,
  series,
  lastPricedAt,
  now,
}: {
  summary: PortfolioSummary;
  currency: string;
  series: PortfolioValuePoint[];
  lastPricedAt: Date | null;
  now: Date;
}) {
  const hasPrices = summary.pricedItemsHeld > 0;
  const gain = summary.unrealized;
  const gainPct =
    summary.investedPriced > 0 ? gain / summary.investedPriced : null;
  const up = gain > 0;
  const down = gain < 0;
  const stale =
    lastPricedAt != null && ageInHours(lastPricedAt, now) >= STALE_PRICE_HOURS;

  const pill = up
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
    : down
      ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
          {hasPrices ? "Portfolio value" : "Invested (at cost)"}
        </div>
        <div
          className={`text-[11px] ${
            stale
              ? "text-amber-600 dark:text-amber-400 font-medium"
              : "text-zinc-500"
          }`}
        >
          {lastPricedAt
            ? `Prices updated ${formatAge(lastPricedAt, now)}`
            : "No prices yet"}
        </div>
      </div>

      <div className="mt-2 text-4xl sm:text-5xl font-semibold tabular-nums tracking-tight leading-none">
        <Money
          amount={hasPrices ? summary.currentValue : summary.invested}
          currency={currency}
        />
      </div>

      {hasPrices ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium tabular-nums ${pill}`}
          >
            <span aria-hidden className="text-[10px]">
              {up ? "▲" : down ? "▼" : "–"}
            </span>
            <Money amount={Math.abs(gain)} currency={currency} />
            {gainPct != null && (
              <span className="opacity-80">
                ({gainPct > 0 ? "+" : gainPct < 0 ? "−" : ""}
                {Math.abs(gainPct * 100).toFixed(1)}%)
              </span>
            )}
          </span>
          <span className="text-xs text-zinc-500">
            {up ? "up" : down ? "down" : "flat"} vs cost, across{" "}
            {summary.pricedItemsHeld} priced item
            {summary.pricedItemsHeld === 1 ? "" : "s"}
          </span>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">
          No market prices yet — use <strong>Update prices</strong> to see what
          your holdings are worth.
        </p>
      )}

      <div className="mt-5 -mx-1">
        <PortfolioValueChart data={series} currency={currency} />
      </div>

      {/* Three columns at every width: stacking them on a phone made the
          hero a full screen tall and pushed "Needs attention" below it.
          Small screens get compact figures (₫1.53B) and drop the hints. */}
      <dl className="mt-5 pt-5 border-t border-zinc-200/80 dark:border-zinc-800 grid grid-cols-3 gap-3 sm:gap-4">
        <Stat
          label="Invested"
          hint={
            summary.unpricedItemsHeld > 0
              ? `${formatCompactAmount(summary.investedPriced, currency)} priced + ${formatCompactAmount(summary.investedUnpriced, currency)} unpriced`
              : `${summary.itemsHeld} held item${summary.itemsHeld === 1 ? "" : "s"}`
          }
          full={<Money amount={summary.invested} currency={currency} />}
          short={formatCompactAmount(summary.invested, currency)}
        />
        <Stat
          label="Realized"
          hint="from items you've sold"
          full={<Money amount={summary.realized} currency={currency} signed />}
          short={
            <SignedCompact amount={summary.realized} currency={currency} />
          }
        />
        <Stat
          label="Total profit"
          hint="realized + unrealized"
          full={<Money amount={summary.total} currency={currency} signed />}
          short={<SignedCompact amount={summary.total} currency={currency} />}
        />
      </dl>

      {summary.unpricedItemsHeld > 0 && hasPrices && (
        <p className="mt-4 text-[11px] text-amber-700 dark:text-amber-400">
          {summary.unpricedItemsHeld} held item
          {summary.unpricedItemsHeld === 1 ? " isn't" : "s aren't"} priced (
          {formatCompactAmount(summary.investedUnpriced, currency)} of cost), so{" "}
          {summary.unpricedItemsHeld === 1 ? "it's" : "they're"} left out of the
          value above.{" "}
          <Link href="/items" className="underline hover:no-underline">
            Update prices
          </Link>
        </p>
      )}
    </Card>
  );
}

function Stat({
  label,
  hint,
  full,
  short,
}: {
  label: string;
  hint: string;
  /** Exact figure, shown from `sm` up. */
  full: React.ReactNode;
  /** Compact figure for phones. */
  short: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </dt>
      <dd className="mt-1 text-base sm:text-xl font-semibold tabular-nums tracking-tight">
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{full}</span>
      </dd>
      <div className="mt-0.5 text-[11px] text-zinc-500 hidden sm:block">
        {hint}
      </div>
    </div>
  );
}

/** Compact signed amount (+₫167M) coloured like `<Money signed>`. */
function SignedCompact({
  amount,
  currency,
}: {
  amount: number;
  currency: string;
}) {
  const color =
    amount > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : amount < 0
        ? "text-rose-600 dark:text-rose-400"
        : "";
  return (
    <span className={color}>
      {amount > 0 ? "+" : amount < 0 ? "−" : ""}
      {formatCompactAmount(Math.abs(amount), currency)}
    </span>
  );
}
