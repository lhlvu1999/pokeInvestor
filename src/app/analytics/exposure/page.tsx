export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card, StatCard } from "@/components/ui";
import { formatAmount, formatCompactAmount } from "@/lib/currency";
import type { Slice } from "@/lib/calc/exposure";
import { tone } from "@/lib/calc/format_delta";
import { changeLabel } from "@/lib/calc/set_list";
import { getExposure, type MoveRow } from "@/lib/server/exposure";
import { getDisplayCurrency } from "@/lib/server/settings";

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;
const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** How many sets to list before tucking the rest behind "show all". */
const SETS_SHOWN = 10;

/**
 * What the stock is made of, and how products like it have actually moved.
 * Everything here is about the past; none of it is a forecast.
 */
export default async function ExposurePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).window;
  const window = (Array.isArray(raw) ? raw[0] : raw) === "30" ? 30 : 90;
  const currency = await getDisplayCurrency();
  const e = await getExposure(currency);

  if (e.holdings.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight">Exposure</h1>
        <Card className="p-6 text-sm text-zinc-500">
          You don&apos;t hold anything yet, so there is nothing to break down.
        </Card>
      </div>
    );
  }

  const unlinked = e.holdings.filter((h) => h.kind === "unlinked");
  const unlinkedCount = unlinked.length;
  const unlinkedShare =
    e.total > 0
      ? unlinked.reduce((a, h) => a + Math.max(0, h.value), 0) / e.total
      : 0;

  const worstAtOnce = (q: "p10" | "p05") => {
    let money = 0;
    for (const r of e.moveRows) {
      const m = r.moves[window];
      if (m) money += r.value * m[q];
    }
    return Math.round(money);
  };
  const covered = e.moveRows
    .filter((r) => r.moves[window])
    .reduce((a, r) => a + r.value, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Exposure</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          What your stock is made of, and how products like it have actually
          moved. It describes the past; it is not a forecast.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Stock value"
          hint={
            e.atCostShare > 0
              ? `${pct(e.atCostShare)} is at cost (no market price)`
              : "at market price"
          }
        >
          {formatCompactAmount(e.total, currency)}
        </StatCard>
        <StatCard label="Items held" hint="with a value">
          <span className="tabular-nums">{e.concentration.items}</span>
        </StatCard>
        <StatCard label="Biggest item" hint="share of the stock">
          {pct(e.concentration.top1)}
        </StatCard>
        <StatCard label="Biggest five" hint="share of the stock">
          {pct(e.concentration.top5)}
        </StatCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SliceCard
          title="By kind of product"
          slices={e.byKind}
          currency={currency}
        />
        <SliceCard
          title="By language"
          slices={e.byLanguage}
          currency={currency}
        />
      </div>
      {unlinkedShare > 0 && (
        <p className="text-xs text-zinc-500 max-w-prose leading-relaxed">
          {`${unlinkedCount} ${unlinkedCount === 1 ? "item isn't" : "items aren't"} linked to the catalogue (${pct(unlinkedShare)} of the value), so they have no set or kind here. `}
          <Link href="/catalog/links" className="underline hover:no-underline">
            Link items to the catalogue
          </Link>{" "}
          to sharpen both views below.
        </p>
      )}
      <SliceCard
        title="By set"
        slices={e.bySet}
        currency={currency}
        shown={SETS_SHOWN}
      />

      {/* ------------------------------------------------------------ */}
      <Card className="p-4">
        <h2 className="font-medium">How far prices have actually moved</h2>
        <p className="text-xs text-zinc-500 mt-0.5 max-w-prose">
          Two different pictures, because they disagree.
        </p>

        {e.stress && (
          <div className="mt-4">
            <h3 className="text-sm font-medium">The market as a whole</h3>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 max-w-prose leading-relaxed">
              Your current mix of products, replayed through history since{" "}
              {dateLabel(e.stress.from)}: the worst stretches would have been
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-4 max-w-md">
              {e.stress.windows.map((w) => (
                <div key={w.days}>
                  <dt className="text-xs text-zinc-500">Worst {w.days} days</dt>
                  {w.window ? (
                    <>
                      <dd
                        className={`text-xl font-semibold tabular-nums ${tone(w.window.change)}`}
                      >
                        {changeLabel(w.window.change)}
                      </dd>
                      <dd className="text-[11px] text-zinc-500">
                        {`${dateLabel(w.window.fromDay)} to ${dateLabel(w.window.toDay)}`}
                        {w.money != null
                          ? ` · ${w.money >= 0 ? "+" : "−"}${formatCompactAmount(Math.abs(w.money), currency)} on today's stock`
                          : ""}
                      </dd>
                    </>
                  ) : (
                    <dd className="text-sm text-zinc-400">—</dd>
                  )}
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
              The market index is the typical product, so it is smooth: products
              falling after launch are offset by older ones rising. That says
              little about a stock concentrated in a few products.
              {` ${pct(e.stress.matchedShare)} of your stock has an index for its own kind; the rest uses all sealed products in English, a rough yardstick.`}
            </p>
          </div>
        )}

        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Individual products</h3>
            <div className="flex gap-2">
              {[30, 90].map((d) => (
                <Link
                  key={d}
                  href={
                    d === 90
                      ? "/analytics/exposure"
                      : `/analytics/exposure?window=${d}`
                  }
                  scroll={false}
                  aria-current={window === d ? "true" : undefined}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    window === d
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {d} days
                </Link>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 max-w-prose leading-relaxed">
            Over any {window} days since the data began, how much a product like
            yours changed: the middle case, and the bad ones.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-2 pr-2 text-left font-medium">Like</th>
                  <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                    You hold
                  </th>
                  <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                    Typical
                  </th>
                  <th
                    className="px-1.5 sm:px-3 py-2 text-right font-medium"
                    title="1 time in 10, a product did this badly or worse"
                  >
                    Worst 1 in 10
                  </th>
                  <th
                    className="px-1.5 sm:px-3 py-2 text-right font-medium hidden sm:table-cell"
                    title="1 time in 20, a product did this badly or worse"
                  >
                    Worst 1 in 20
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {e.moveRows.map((r) => (
                  <MoveRowView
                    key={r.key}
                    r={r}
                    window={window}
                    currency={currency}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {covered > 0 && (
            <div className="mt-3 rounded-lg bg-zinc-100 dark:bg-zinc-800/60 p-3 text-sm max-w-xl">
              <div className="font-medium">
                If every product you hold had a bad {window} days at once
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                {`A "worst 1 in 10" case for each kind: ${worstAtOnce("p10") >= 0 ? "+" : "−"}${formatAmount(Math.abs(worstAtOnce("p10")), currency)} (${changeLabel(worstAtOnce("p10") / covered)}). A "worst 1 in 20" case: ${worstAtOnce("p05") >= 0 ? "+" : "−"}${formatAmount(Math.abs(worstAtOnce("p05")), currency)} (${changeLabel(worstAtOnce("p05") / covered)}). Everything falling together is harsher than a normal month, because history's bad cases rarely land on every product at once.${
                  e.stress
                    ? ` Only ${pct(e.stress.matchedShare)} of your stock has an index of its own kind; the rest (tins, collections, slabs and anything not linked) is measured against all sealed products, a rough stand-in.`
                    : ""
                }`}
              </div>
            </div>
          )}

          <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
            Every window of that many days counts, for products of every age
            together; products in their first months have usually fallen more
            (see{" "}
            <Link
              href="/catalog/insights"
              className="underline hover:no-underline"
            >
              Set insights
            </Link>
            ). A move beyond 10 times either way is treated as bad data and left
            out. Past moves are not a forecast.
          </p>
        </div>
      </Card>
    </div>
  );
}

function SliceCard({
  title,
  slices,
  currency,
  shown,
}: {
  title: string;
  slices: Slice[];
  currency: string;
  shown?: number;
}) {
  const first = shown ? slices.slice(0, shown) : slices;
  const rest = shown ? slices.slice(shown) : [];
  return (
    <Card className="p-4">
      <h2 className="font-medium">{title}</h2>
      <Rows slices={first} currency={currency} />
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:underline py-2">
            {`Show ${rest.length} more`}
          </summary>
          <Rows slices={rest} currency={currency} />
        </details>
      )}
    </Card>
  );
}

function Rows({ slices, currency }: { slices: Slice[]; currency: string }) {
  return (
    <ul className="mt-3 flex flex-col gap-2.5">
      {slices.map((s) => (
        <li key={s.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {s.label}
              <span className="ml-1.5 text-[11px] text-zinc-500">
                {`${s.items} ${s.items === 1 ? "item" : "items"}`}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-medium">{pct(s.share)}</span>
              <span className="ml-2 text-xs text-zinc-500">
                {formatCompactAmount(s.value, currency)}
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-sky-500"
              style={{ width: `${Math.max(1, s.share * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MoveRowView({
  r,
  window,
  currency,
}: {
  r: MoveRow;
  window: 30 | 90;
  currency: string;
}) {
  const m = r.moves[window];
  const money = (q: number) =>
    `${q >= 0 ? "+" : "−"}${formatCompactAmount(Math.abs(Math.round(r.value * q)), currency)}`;
  return (
    <tr>
      <td className="py-2 pr-2 min-w-0">
        <div className="font-medium">{r.label}</div>
        {m && (
          <div className="text-[11px] text-zinc-500">
            {`${m.products} products · ${m.windows.toLocaleString("en-US")} windows`}
          </div>
        )}
      </td>
      <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
        {formatCompactAmount(r.value, currency)}
        <div className="text-[11px] text-zinc-500">{pct(r.share)}</div>
      </td>
      {m ? (
        <>
          <td
            className={`px-1.5 sm:px-3 py-2 text-right tabular-nums ${tone(m.p50)}`}
          >
            {changeLabel(m.p50)}
          </td>
          <td
            className={`px-1.5 sm:px-3 py-2 text-right tabular-nums ${tone(m.p10)}`}
          >
            {changeLabel(m.p10)}
            <div className="text-[11px] text-zinc-500">{money(m.p10)}</div>
          </td>
          <td
            className={`px-1.5 sm:px-3 py-2 text-right tabular-nums hidden sm:table-cell ${tone(m.p05)}`}
          >
            {changeLabel(m.p05)}
            <div className="text-[11px] text-zinc-500">{money(m.p05)}</div>
          </td>
        </>
      ) : (
        <td colSpan={3} className="px-3 py-2 text-right text-zinc-400">
          no history
        </td>
      )}
    </tr>
  );
}
