export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card } from "@/components/ui";
import { POSITION_TEXT, POSITION_TONE } from "@/components/LifecycleCard";
import { THIN_SETS } from "@/lib/calc/lifecycle";
import type { LaunchStep } from "@/lib/calc/launch_path";
import { showUsd, type Fx } from "@/lib/calc/catalog_money";
import { whenLabel } from "@/lib/calc/release_calendar";
import { SEALED_TYPE_LABELS } from "@/lib/calc/sealed_type";
import { changeLabel } from "@/lib/calc/set_list";
import {
  getPreorderHistory,
  getReleaseCalendar,
  TOO_EARLY_DAYS,
  type PreorderRow,
  type CalendarProduct,
  type CalendarSetRow,
} from "@/lib/server/catalog_calendar";
import { getUsdFx } from "@/lib/server/catalog_fx";
import { getDisplayCurrency } from "@/lib/server/settings";

const tone = (c: number) =>
  c > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : c < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-500";

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const STEP_HEAD: Record<number, string> = {
  0: "At release",
  7: "+1 week",
  30: "+1 month",
  90: "+3 months",
};

/**
 * Sets coming up and sets just out. For each product: its price, and what
 * earlier launches did from the same point. Dates are TCGplayer's listing
 * dates, which can move.
 */
export default async function CalendarPage() {
  const currency = await getDisplayCurrency();
  const [cal, fx, preorders] = await Promise.all([
    getReleaseCalendar(),
    getUsdFx(currency),
    getPreorderHistory(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Release calendar
        </h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          Sets coming up and sets just out, with what their products cost and
          what earlier launches did from the same point. Release dates are
          TCGplayer&apos;s listing dates and can move. These describe past
          launches; they are not a forecast.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Coming up</h2>
        {cal.upcoming.length === 0 ? (
          <Card className="p-5 text-sm text-zinc-500">
            No upcoming sets are listed yet. TCGplayer usually lists a set a few
            weeks before it comes out.
          </Card>
        ) : (
          cal.upcoming.map((s) => (
            <UpcomingSet key={s.groupId} set={s} fx={fx} />
          ))
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">
          Just out{" "}
          <span className="text-xs font-normal text-zinc-500">
            last 45 days
          </span>
        </h2>
        {cal.recent.length === 0 ? (
          <Card className="p-5 text-sm text-zinc-500">
            No sets came out in the last 45 days.
          </Card>
        ) : (
          cal.recent.map((s) => <RecentSet key={s.groupId} set={s} fx={fx} />)
        )}
      </section>

      <PreorderHistory rows={preorders} />

      <p className="text-[11px] text-zinc-500 leading-relaxed max-w-prose">
        Each comparison covers boxes, trainer boxes, bundles and packs from sets
        released since February 2024, and only shows a figure when at least 5
        earlier sets have one.{" "}
        {cal.today ? `Prices as of ${dateLabel(cal.today)}. ` : ""}
        English pre-order prices exist from about two months before release;
        Japanese products usually aren&apos;t priced on TCGplayer until release
        day, so they have no pre-order comparison.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SetHeader({ set, suffix }: { set: CalendarSetRow; suffix?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <Link
          href={`/catalog/sets/${set.groupId}`}
          className="font-medium hover:underline"
        >
          {set.name}
        </Link>
        <span className="ml-2 rounded-full border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
          {set.language === "ja" ? "Japanese" : "English"}
        </span>
      </div>
      <div className="text-sm tabular-nums">
        <span className="font-medium">{whenLabel(set.daysAway)}</span>{" "}
        <span className="text-zinc-500">
          {dateLabel(set.releasedOn)}
          {suffix ?? ""}
        </span>
      </div>
    </div>
  );
}

function Price({ cents, fx }: { cents: number | null; fx: Fx | null }) {
  if (cents == null) return <span className="text-zinc-400">—</span>;
  const s = showUsd(cents, fx);
  return (
    <>
      <span className="font-medium">{s.primary}</span>
      {s.secondary && (
        <div className="text-[11px] font-normal text-zinc-500">
          {s.secondary}
        </div>
      )}
    </>
  );
}

function Step({ step }: { step: LaunchStep | undefined }) {
  if (!step) return <span className="text-zinc-400">—</span>;
  return (
    <>
      <span className={tone(step.median)}>{changeLabel(step.median)}</span>
      <div className="text-[11px] text-zinc-500">
        {`${step.sets} sets${step.sets < THIN_SETS ? " (few)" : ""}`}
      </div>
    </>
  );
}

function NoProducts({ set }: { set: CalendarSetRow }) {
  return (
    <p className="mt-3 text-sm text-zinc-500 max-w-prose">
      {set.sealedCount === 0
        ? set.language === "ja"
          ? "No products are listed yet. Japanese sealed products are usually priced on TCGplayer only from release day."
          : "No products are listed yet."
        : `${set.sealedCount} product${set.sealedCount === 1 ? "" : "s"} listed, none of them a booster box, trainer box, bundle or pack.`}
    </p>
  );
}

/* ---------------------------- coming up ---------------------------- */

function UpcomingSet({ set, fx }: { set: CalendarSetRow; fx: Fx | null }) {
  const priced = set.products.filter((p) => p.priceCents != null);
  const tooEarly = set.daysAway > TOO_EARLY_DAYS && priced.length > 0;
  const startsIn = set.daysAway - 60;
  const fromAge = priced.find((p) => p.fromAge != null)?.fromAge ?? null;

  return (
    <Card className="p-4">
      <SetHeader set={set} />
      {set.products.length === 0 ? (
        <NoProducts set={set} />
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-2 pr-2 text-left font-medium">Product</th>
                  <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                    Price
                  </th>
                  {!tooEarly &&
                    [0, 7, 30, 90].map((a) => (
                      <th
                        key={a}
                        className={`px-1.5 sm:px-3 py-2 text-right font-medium ${
                          a === 7 || a === 90 ? "hidden sm:table-cell" : ""
                        }`}
                      >
                        {STEP_HEAD[a]}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {set.products.map((p) => (
                  <ProductRow
                    key={p.productId}
                    p={p}
                    fx={fx}
                    hideSteps={tooEarly}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {tooEarly && (
            <p className="mt-2 text-xs text-zinc-500 max-w-prose leading-relaxed">
              {`Too early to compare: past launches first have prices about two months before release, and this one is ${set.daysAway} days out. The comparison appears around ${dateLabel(
                new Date(
                  Date.parse(`${set.releasedOn}T00:00:00Z`) - 60 * 86_400_000,
                )
                  .toISOString()
                  .slice(0, 10),
              )} (in ${startsIn} days).`}
            </p>
          )}
          {!tooEarly && fromAge != null && priced.length > 0 && (
            <p className="mt-2 text-[11px] text-zinc-500">
              {`Changes are from today's price, measured the way earlier launches were from about ${-fromAge === 0 ? "release day" : `${-fromAge} days before release`}.`}
            </p>
          )}
          {set.otherProducts > 0 && (
            <p className="mt-1 text-[11px] text-zinc-500">
              {`Plus ${set.otherProducts} other product${set.otherProducts === 1 ? "" : "s"} (tins, collections and the like) ${set.otherProducts === 1 ? "isn't" : "aren't"} compared.`}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function ProductRow({
  p,
  fx,
  hideSteps,
}: {
  p: CalendarProduct;
  fx: Fx | null;
  hideSteps: boolean;
}) {
  const by = new Map(p.steps.map((s) => [s.toAge, s]));
  return (
    <tr>
      <td className="py-2 pr-2 min-w-0">
        <div className="font-medium">{SEALED_TYPE_LABELS[p.kind]}</div>
        <div className="text-[11px] text-zinc-500 truncate max-w-[6.5rem] sm:max-w-[16rem]">
          {p.name}
        </div>
      </td>
      <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
        <Price cents={p.priceCents} fx={fx} />
      </td>
      {!hideSteps &&
        [0, 7, 30, 90].map((a) => (
          <td
            key={a}
            className={`px-1.5 sm:px-3 py-2 text-right tabular-nums ${
              a === 7 || a === 90 ? "hidden sm:table-cell" : ""
            }`}
          >
            <Step step={by.get(a)} />
          </td>
        ))}
    </tr>
  );
}

/* ----------------------------- just out ---------------------------- */

function RecentSet({ set, fx }: { set: CalendarSetRow; fx: Fx | null }) {
  return (
    <Card className="p-4">
      <SetHeader set={set} />
      {set.products.length === 0 ? (
        <NoProducts set={set} />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-2 text-left font-medium">Product</th>
                <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                  Price
                </th>
                <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                  Moved
                </th>
                <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">
                  Against earlier launches
                </th>
                <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                  Earlier sets next
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {set.products.map((p) => {
                const next = p.steps.find((s) => s.toAge === 30) ?? p.steps[0];
                return (
                  <tr key={p.productId}>
                    <td className="py-2 pr-2 min-w-0">
                      <div className="font-medium">
                        {SEALED_TYPE_LABELS[p.kind]}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate max-w-[6.5rem] sm:max-w-[16rem]">
                        {p.name}
                      </div>
                    </td>
                    <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
                      <Price cents={p.priceCents} fx={fx} />
                    </td>
                    <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
                      {p.own ? (
                        <>
                          <span className={tone(p.own.change)}>
                            {changeLabel(p.own.change)}
                          </span>
                          <div className="text-[11px] text-zinc-500">
                            {p.own.baseAge === 0
                              ? "since release"
                              : `since day ${p.own.baseAge}`}
                          </div>
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      {p.position && p.typical ? (
                        <>
                          <span
                            className={`text-xs ${POSITION_TONE[p.position]}`}
                          >
                            {POSITION_TEXT[p.position]}
                          </span>
                          <div className="text-[11px] text-zinc-500">
                            {`typical ${changeLabel(p.typical.median)} · ${p.typical.sets} sets${p.typical.sets < THIN_SETS ? " (few)" : ""}`}
                          </div>
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
                      <Step step={next} />
                      {next && (
                        <div className="text-[11px] text-zinc-500">
                          {`to day ${next.toAge}`}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {set.otherProducts > 0 && (
        <p className="mt-2 text-[11px] text-zinc-500">
          {`Plus ${set.otherProducts} other product${set.otherProducts === 1 ? "" : "s"} ${set.otherProducts === 1 ? "isn't" : "aren't"} compared.`}
        </p>
      )}
    </Card>
  );
}

/* ------------------------ pre-order history ------------------------ */

const START_LABEL: Record<number, string> = {
  [-60]: "60 days before",
  [-30]: "30 days before",
  [-7]: "1 week before",
};

/**
 * How English pre-orders have moved, for every kind of product: the typical
 * change from a point before release to release day and beyond. Always shown,
 * whether or not a set is currently on pre-order.
 */
function PreorderHistory({ rows }: { rows: PreorderRow[] }) {
  const shown = rows.filter((r) => r.steps.length > 0);
  if (shown.length === 0) return null;
  return (
    <Card className="p-4">
      <h2 className="font-medium">How English pre-orders have moved</h2>
      <p className="text-xs text-zinc-500 mt-0.5 max-w-prose">
        The typical change in a product&apos;s price from a point before
        release, across sets released since the history began.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="py-2 pr-2 text-left font-medium">Product</th>
              <th className="px-1.5 sm:px-3 py-2 text-left font-medium">
                From
              </th>
              <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                At release
              </th>
              <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                +1 month
              </th>
              <th className="px-1.5 sm:px-3 py-2 text-right font-medium hidden sm:table-cell">
                +3 months
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {shown.map((r) => {
              const by = new Map(r.steps.map((s) => [s.toAge, s]));
              return (
                <tr key={`${r.kind}${r.fromAge}`}>
                  <td className="py-2 pr-2 font-medium">
                    {SEALED_TYPE_LABELS[r.kind]}
                  </td>
                  <td className="px-1.5 sm:px-3 py-2 text-zinc-500 whitespace-nowrap">
                    {START_LABEL[r.fromAge]}
                  </td>
                  <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
                    <Step step={by.get(0)} />
                  </td>
                  <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
                    <Step step={by.get(30)} />
                  </td>
                  <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums hidden sm:table-cell">
                    <Step step={by.get(90)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
        Figures are the median set; each says how many sets are behind it.
        Pre-order prices are TCGplayer market prices for products not yet out.
      </p>
    </Card>
  );
}
