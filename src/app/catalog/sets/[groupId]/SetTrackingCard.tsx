import { Card } from "@/components/ui";
import { POSITION_TEXT, POSITION_TONE } from "@/components/LifecycleCard";
import { showUsd, type Fx } from "@/lib/calc/catalog_money";
import { CARD_METRIC_LABELS } from "@/lib/calc/card_curve";
import {
  ageLabel,
  PHASE_LABELS,
  spanLabel,
  THIN_SETS,
} from "@/lib/calc/lifecycle";
import { SEALED_TYPE_LABELS } from "@/lib/calc/sealed_type";
import { changeLabel } from "@/lib/calc/set_list";
import type { SetTrackingData } from "@/lib/server/catalog_set_tracking";

const tone = (c: number) =>
  c > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : c < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-500";

const baseName = (a: number) => (a === 0 ? "release" : `day ${a}`);

/**
 * How one set is tracking against earlier sets at the same age: its chase and
 * set value, its sealed products, and what earlier sets did next. Describes
 * what earlier sets did, not what this one will.
 */
export function SetTrackingCard({
  data,
  prices,
  fx,
}: {
  data: SetTrackingData;
  /** Market price (US cents) of each sealed product, by product id. */
  prices: Map<number, number | null>;
  fx: Fx | null;
}) {
  const { tracking, releasedOn, products } = data;
  if (tracking.ageDays == null || tracking.phase == null) return null;
  const released = releasedOn
    ? new Date(`${releasedOn}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <Card className="p-4">
      <h2 className="font-medium">How this set is tracking</h2>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold">
          {ageLabel(tracking.ageDays)}
        </span>
        <span className="text-sm text-zinc-500">
          {PHASE_LABELS[tracking.phase]}
          {released ? ` · released ${released}` : ""}
        </span>
      </div>

      {tracking.cards.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-2 text-left font-medium">Cards</th>
                <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                  This set
                </th>
                <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                  Earlier sets
                </th>
                <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">
                  Against them
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {tracking.cards.map((c) => (
                <tr key={c.metric}>
                  <td className="py-2 pr-2">
                    <div className="font-medium">
                      {CARD_METRIC_LABELS[c.metric]}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {`since ${baseName(c.baseAge)}`}
                    </div>
                  </td>
                  <td
                    className={`px-1.5 sm:px-3 py-2 text-right tabular-nums font-medium ${tone(c.own)}`}
                  >
                    {changeLabel(c.own)}
                  </td>
                  <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
                    {c.typical ? (
                      <>
                        {changeLabel(c.typical.median)}
                        <div className="text-[11px] text-zinc-500">
                          {`${c.typical.sets} sets${c.typical.sets < THIN_SETS ? " (few)" : ""}`}
                        </div>
                      </>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    {c.position ? (
                      <span className={`text-xs ${POSITION_TONE[c.position]}`}>
                        {POSITION_TEXT[c.position]}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500 max-w-prose">
          {tracking.ageDays < 0
            ? "This set isn't out yet."
            : releasedOn && data.historyStart && releasedOn < data.historyStart
              ? "This set came out before the price history began, so there is no launch to compare its card values with."
              : "The card values can't be compared yet: the history doesn't reach back to a day when about as many of this set's cards were priced as now, so any change would mostly be cards gaining prices."}
        </p>
      )}

      {tracking.forward.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-zinc-500">
            From about this age, earlier sets&apos; top 20 cards:
          </div>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {tracking.forward.map((f) => (
              <li key={f.toAge}>
                <span className="inline-block first-letter:uppercase">
                  {spanLabel(f.toAge - f.fromAge)}
                </span>
                :{" "}
                <span className={`font-medium tabular-nums ${tone(f.median)}`}>
                  {changeLabel(f.median)}
                </span>{" "}
                <span className="text-xs text-zinc-500">
                  {`median · ${Math.round(f.shareUp * 100)}% rose · middle half ${changeLabel(f.p25)} to ${changeLabel(f.p75)} · ${f.sets} sets`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {products.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-2 text-left font-medium">Sealed</th>
                <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                  Market
                </th>
                <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                  Moved
                </th>
                <th className="px-3 py-2 text-right font-medium hidden md:table-cell">
                  Earlier sets
                </th>
                <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">
                  Against them
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {products.map((p) => {
                const cents = prices.get(p.productId) ?? null;
                const shown = cents != null ? showUsd(cents, fx) : null;
                return (
                  <tr key={p.productId}>
                    <td className="py-2 pr-2 min-w-0">
                      <div className="font-medium">
                        {SEALED_TYPE_LABELS[p.kind!]}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate max-w-[6.5rem] sm:max-w-[16rem]">
                        {p.name}
                      </div>
                    </td>
                    <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
                      {shown ? (
                        <>
                          <span className="font-medium">{shown.primary}</span>
                          {shown.secondary && (
                            <div className="text-[11px] text-zinc-500">
                              {shown.secondary}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
                      {p.own ? (
                        <>
                          <span className={tone(p.own.change)}>
                            {changeLabel(p.own.change)}
                          </span>
                          <div className="text-[11px] text-zinc-500">
                            {`since ${baseName(p.own.baseAge)}`}
                          </div>
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                      {p.typical ? (
                        <>
                          {changeLabel(p.typical.median)}
                          <div className="text-[11px] text-zinc-500">
                            {`${p.typical.sets} sets${p.typical.sets < THIN_SETS ? " (few)" : ""}`}
                          </div>
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      {p.position ? (
                        <span className={`text-xs ${POSITION_TONE[p.position]}`}>
                          {POSITION_TEXT[p.position]}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
        Earlier sets are those released since the history began (English with
        English, Japanese with Japanese), leaving this one out. Card values only
        count when about as many cards were priced on both days. Past sets only,
        not a forecast.
      </p>
    </Card>
  );
}
