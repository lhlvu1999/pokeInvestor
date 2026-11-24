export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card } from "@/components/ui";
import { RateCell } from "@/components/ReturnBasisCard";
import { tone } from "@/lib/calc/format_delta";
import {
  BASES,
  BASIS_LABELS,
  UNAVAILABLE_TEXT,
  durationLabel,
  parseBasis,
  type Basis,
  type ReturnResult,
} from "@/lib/calc/position_return";
import { changeLabel } from "@/lib/calc/set_list";
import {
  getPositionReturns,
  type PositionRow,
} from "@/lib/server/position_returns";

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const href = (b: Basis) =>
  b === "purchase" ? "/analytics/returns" : `/analytics/returns?basis=${b}`;

/** Best rate first, then the ones still too young, then the unmeasurable. */
function order(a: ReturnResult, b: ReturnResult): number {
  const rank = (r: ReturnResult) =>
    r.status === "ok" ? 0 : r.status === "too_early" ? 1 : 2;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.status === "ok" && b.status === "ok") return b.annualized - a.annualized;
  if (a.status === "too_early" && b.status === "too_early") {
    return a.daysToGo - b.daysToGo;
  }
  return 0;
}

/**
 * Annualized return for every position you hold, from a choice of starting
 * point: your own purchases, the product's launch price, or its price 6
 * months or a year ago.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const basis = parseBasis((await searchParams).basis);
  const rows = await getPositionReturns(new Date());
  const sorted = [...rows].sort(
    (a, b) =>
      order(a.results[basis], b.results[basis]) || a.name.localeCompare(b.name),
  );

  const counts = { ok: 0, too_early: 0, unavailable: 0 };
  const why = new Map<string, number>();
  for (const r of rows) {
    const res = r.results[basis];
    counts[res.status] += 1;
    if (res.status === "unavailable") {
      why.set(res.reason, (why.get(res.reason) ?? 0) + 1);
    }
  }
  const other: Basis = basis === "purchase" ? "launch" : "purchase";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Returns by position
        </h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          The yearly rate on each position you hold, from a starting point you
          choose. Nothing is shown for anything under 90 days old: a yearly
          rate worked out from a few weeks mostly measures luck.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500 w-full sm:w-auto sm:mr-2">
            From
          </span>
          {BASES.map((b) => (
            <Link
              key={b}
              href={href(b)}
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
        <p className="mt-3 text-xs text-zinc-500 leading-relaxed max-w-prose">
          {basis === "purchase"
            ? "What you earned: a money-weighted rate over your own buys and sales of each item, with what you still hold at today's market price (at cost where it has none)."
            : "What the product itself did from that starting point, from catalogue prices. It isn't what you earned; put it beside “My purchases” to see whether your entry price helped or hurt."}
        </p>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
          {`${counts.ok} of ${rows.length} positions have a rate on this basis`}
          {counts.too_early > 0 ? `, ${counts.too_early} are under 90 days` : ""}
          {counts.unavailable > 0
            ? `, ${counts.unavailable} can't be measured`
            : ""}
          .
        </p>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 sm:px-4 py-2 text-left font-medium">Item</th>
              <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                A year
              </th>
              <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                Total
              </th>
              <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">
                Over
              </th>
              <th className="px-3 py-2 text-right font-medium hidden md:table-cell">
                {BASIS_LABELS[other]}
              </th>
              <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">
                Note
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {sorted.map((r) => (
              <Row key={r.itemId} r={r} basis={basis} other={other} />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  You don&apos;t hold anything yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Row({
  r,
  basis,
  other,
}: {
  r: PositionRow;
  basis: Basis;
  other: Basis;
}) {
  const res = r.results[basis];
  return (
    <tr>
      <td className="px-3 sm:px-4 py-2 min-w-0">
        <Link href={`/items/${r.itemId}`} className="font-medium hover:underline">
          {r.name}
        </Link>
        <div className="text-[11px] text-zinc-500">{`${r.held} held`}</div>
      </td>
      <td className="px-1.5 sm:px-3 py-2 text-right font-medium">
        <RateCell result={res} />
      </td>
      <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
        {res.status === "ok" ? (
          <span className={tone(res.change)}>{changeLabel(res.change)}</span>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-zinc-500 hidden sm:table-cell whitespace-nowrap">
        {res.status === "unavailable" ? (
          "—"
        ) : (
          <>
            {durationLabel(res.days)}
            <div className="text-[11px]">{`from ${dateLabel(res.entryDay)}`}</div>
          </>
        )}
      </td>
      <td className="px-3 py-2 text-right hidden md:table-cell">
        <RateCell result={r.results[other]} />
      </td>
      <td className="px-3 py-2 text-xs text-zinc-500 hidden lg:table-cell max-w-xs">
        {res.status === "unavailable"
          ? UNAVAILABLE_TEXT[res.reason]
          : res.status === "ok" && res.extrapolated
            ? "Under a year, so a projection."
            : res.status === "too_early"
              ? `Appears after ${res.daysToGo} more ${res.daysToGo === 1 ? "day" : "days"}.`
              : ""}
      </td>
    </tr>
  );
}
