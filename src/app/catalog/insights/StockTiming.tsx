import Link from "next/link";
import { Card } from "@/components/ui";
import { POSITION_TEXT, POSITION_TONE } from "@/components/LifecycleCard";
import {
  ageLabel,
  PHASE_LABELS,
  spanLabel,
  THIN_SETS,
  type Phase,
} from "@/lib/calc/lifecycle";
import { formatCompactAmount } from "@/lib/currency";
import { changeLabel } from "@/lib/calc/set_list";
import type { StockTiming as Data } from "@/lib/server/catalog_lifecycle";

const PHASE_COLOR: Record<Phase, string> = {
  upcoming: "bg-violet-500",
  launch: "bg-sky-500",
  early: "bg-teal-500",
  first_year: "bg-emerald-500",
  established: "bg-zinc-400 dark:bg-zinc-500",
};

const tone = (c: number) =>
  c > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : c < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-500";

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** How many rows to show before tucking the rest behind "show all". */
const SHOWN = 12;

/**
 * Your held stock on the age picture: how your money splits by how old the
 * products are, and for each product how it has moved against what earlier
 * sets of the same kind typically did by that age.
 */
export function StockTiming({ data }: { data: Data }) {
  const dated = data.rows.filter((r) => r.lifecycle?.ageDays != null);
  if (data.rows.length === 0) return null;

  const { cost } = data;
  const shown = dated.slice(0, SHOWN);
  const rest = dated.slice(SHOWN);

  return (
    <Card className="p-4">
      <h2 className="font-medium">Your stock by age</h2>
      <p className="text-xs text-zinc-500 mt-0.5 max-w-prose">
        How old the products you hold are, and how each has moved against
        earlier sets of the same kind.
      </p>

      {cost.total > 0 && (
        <div className="mt-4">
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            role="img"
            aria-label={`Inventory cost by age: ${[
              ...cost.shares.map((s) => `${s.label} ${pct(s.share)}`),
              ...(cost.unknownShare > 0
                ? [`age unknown ${pct(cost.unknownShare)}`]
                : []),
            ].join(", ")}`}
          >
            {cost.shares.map((s) => (
              <div
                key={s.phase}
                className={PHASE_COLOR[s.phase]}
                style={{ width: `${s.share * 100}%` }}
              />
            ))}
            {cost.unknownShare > 0 && (
              <div
                className="bg-zinc-300 dark:bg-zinc-600"
                style={{ width: `${cost.unknownShare * 100}%` }}
              />
            )}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {cost.shares.map((s) => (
              <li key={s.phase} className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${PHASE_COLOR[s.phase]}`}
                />
                {`${s.label} ${pct(s.share)}`}
              </li>
            ))}
            {cost.unknownShare > 0 && (
              <li className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                {`Age unknown ${pct(cost.unknownShare)}`}
              </li>
            )}
          </ul>
          <p className="mt-1 text-[11px] text-zinc-500">
            Share of what you paid for the stock you still hold.
          </p>
        </div>
      )}

      {dated.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <Rows rows={shown} currency={data.currency} />
          {rest.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-zinc-500 hover:underline py-2">
                {`Show ${rest.length} more`}
              </summary>
              <Rows rows={rest} currency={data.currency} />
            </details>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
        {data.unlinked > 0
          ? `${data.unlinked} of the items you hold aren't compared: they aren't linked to the catalogue, or aren't boxes, trainer boxes, bundles or packs. `
          : ""}
        <Link href="/catalog/links" className="underline hover:no-underline">
          Link items to the catalogue
        </Link>
        {" · "}Past sets only, not a forecast.
      </p>
    </Card>
  );
}

function Rows({
  rows,
  currency,
}: {
  rows: Data["rows"];
  currency: Data["currency"];
}) {
  return (
    <table className="w-full text-xs sm:text-sm">
      <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          <th className="py-2 pr-2 text-left font-medium">Item</th>
          <th className="px-1.5 sm:px-3 py-2 text-right font-medium">Age</th>
          <th className="px-1.5 sm:px-3 py-2 text-right font-medium">Moved</th>
          <th className="px-3 py-2 text-right font-medium hidden md:table-cell">
            Typical
          </th>
          <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">
            Against typical
          </th>
          <th className="px-3 py-2 text-right font-medium hidden lg:table-cell">
            Earlier sets next
          </th>
          <th className="py-2 pl-3 text-right font-medium hidden md:table-cell">
            Cost
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {rows.map((r) => {
          const l = r.lifecycle!;
          const fwd = l.forward[0];
          return (
            <tr key={r.itemId}>
              <td className="py-2 pr-2 min-w-0">
                <Link
                  href={`/items/${r.itemId}`}
                  className="font-medium hover:underline"
                >
                  {r.name}
                </Link>
                <div className="text-[11px] text-zinc-500">
                  {`${r.held} held`}
                </div>
              </td>
              <td className="px-1.5 sm:px-3 py-2 text-right whitespace-nowrap">
                {ageLabel(l.ageDays!).replace(" old", "")}
                <div className="text-[11px] text-zinc-500">
                  {PHASE_LABELS[l.phase!]}
                </div>
              </td>
              <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums">
                {l.own ? (
                  <>
                    <span className={tone(l.own.change)}>
                      {changeLabel(l.own.change)}
                    </span>
                    <div className="text-[11px] text-zinc-500">
                      {l.own.baseAge === 0
                        ? "since release"
                        : `since day ${l.own.baseAge}`}
                    </div>
                  </>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                {l.typical ? (
                  <>
                    {changeLabel(l.typical.median)}
                    <div className="text-[11px] text-zinc-500">
                      {`${l.typical.sets} sets`}
                    </div>
                  </>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 hidden sm:table-cell">
                {l.position ? (
                  <>
                    <span className={`text-xs ${POSITION_TONE[l.position]}`}>
                      {POSITION_TEXT[l.position]}
                    </span>
                    {l.typical && l.typical.sets < THIN_SETS && (
                      <span className="text-[11px] text-zinc-500">
                        {" "}
                        (few sets)
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums hidden lg:table-cell">
                {fwd ? (
                  <>
                    <span className={tone(fwd.median)}>
                      {changeLabel(fwd.median)}
                    </span>
                    <div className="text-[11px] text-zinc-500">
                      {`${spanLabel(fwd.toAge - fwd.fromAge)} · ${fwd.sets} sets`}
                    </div>
                  </>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="py-2 pl-3 text-right tabular-nums text-zinc-500 hidden md:table-cell">
                {formatCompactAmount(r.cost, currency)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
