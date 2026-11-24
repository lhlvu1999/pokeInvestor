export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card } from "@/components/ui";
import { Chip, Chips, Legend, tone } from "../insights/parts";
import {
  COMPARE_COLORS,
  COMPARE_SWATCH,
  CompareChart,
  type CompareLine,
} from "./CompareChart";
import {
  CARD_BASE_AGES,
  CARD_METRIC_LABELS,
  CARD_METRICS,
  setCurve,
} from "@/lib/calc/card_curve";
import {
  MAX_COMPARE,
  compareHref,
  parseCompareParams,
  type CompareParams,
} from "@/lib/calc/compare_params";
import { ageLabel } from "@/lib/calc/lifecycle";
import { releaseLabel, changeLabel } from "@/lib/calc/set_list";
import { daysBetween } from "@/lib/calc/set_history";
import { pathAt, setPath, type PathPoint } from "@/lib/calc/set_path";
import {
  getCompareSets,
  searchSets,
  type CompareSet,
} from "@/lib/server/catalog_compare";
import { getAgedSets } from "@/lib/server/catalog_insights";

const BASE_LABELS: Record<number, string> = {
  0: "Release day",
  7: "Day 7",
  14: "Day 14",
  30: "Day 30",
};

/** The figure at an age, only if the path actually reaches that age. */
function valueAt(path: PathPoint[], age: number): PathPoint | null {
  const last = path[path.length - 1];
  return last && last.age >= age ? pathAt(path, age) : null;
}

/** Why a set has no path, in plain words. */
function whyNoPath(s: CompareSet, base: number): string {
  if (!s.releasedOn) return "No reliable release date.";
  const first = s.days[0];
  if (!first) return "No price history.";
  if (daysBetween(s.releasedOn, first.day) > base + 3) {
    return "Came out before the price history began, so there's no launch to start from.";
  }
  return `Too few of its cards were priced on ${base === 0 ? "release day" : `day ${base}`} to compare.`;
}

/**
 * Put sets side by side by age: how each one's chase (top 20), top 10 or whole
 * value has moved since a starting age, against the typical range of earlier
 * sets. Choices live in the URL.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseCompareParams(await searchParams);
  const [sets, matches] = await Promise.all([
    getCompareSets(params.sets),
    searchSets(params.q),
  ]);
  const chosen = new Set(sets.map((s) => s.groupId));

  const paths = sets.map((s) =>
    s.releasedOn ? setPath(s.days, s.releasedOn, params.card, params.base) : [],
  );
  const lines: CompareLine[] = sets.map((s, i) => ({
    label: s.name,
    stroke: COMPARE_COLORS[i % COMPARE_COLORS.length],
    points: paths[i],
  }));

  // The typical range: earlier sets in the same language as the first set,
  // leaving out the ones being compared.
  const bandLanguage = sets[0]?.language ?? null;
  const band =
    params.band && bandLanguage
      ? setCurve(
          (await getAgedSets()).filter((s) => !chosen.has(s.groupId)),
          { metric: params.card, baseAge: params.base, language: bandLanguage },
        )
      : null;
  const drawable = lines.some((l) => l.points.length > 1);

  const here = (change: Partial<CompareParams>) => compareHref(params, change);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare sets</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          {`Put up to ${MAX_COMPARE} sets side by side by age: how each one's card values have moved since a starting day, against the typical range of earlier sets. It describes what happened; it is not a forecast.`}
        </p>
      </div>

      <Card className="p-4">
        <h2 className="font-medium text-sm">Sets</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {sets.length === 0 && (
            <span className="text-sm text-zinc-500">
              None yet. Search for a set below.
            </span>
          )}
          {sets.map((s, i) => (
            <span
              key={s.groupId}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-300 dark:border-zinc-700 pl-2.5 pr-1 py-1 text-xs"
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${COMPARE_SWATCH[i % COMPARE_SWATCH.length]}`}
              />
              {s.name}
              <Link
                href={here({
                  sets: params.sets.filter((id) => id !== s.groupId),
                })}
                scroll={false}
                aria-label={`Remove ${s.name}`}
                className="rounded-full px-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ✕
              </Link>
            </span>
          ))}
        </div>

        {params.sets.length < MAX_COMPARE && (
          <form
            action="/catalog/compare"
            method="get"
            className="mt-3 flex gap-2"
          >
            {params.sets.length > 0 && (
              <input type="hidden" name="sets" value={params.sets.join(",")} />
            )}
            <input type="hidden" name="card" value={params.card} />
            <input type="hidden" name="base" value={params.base} />
            {!params.band && <input type="hidden" name="band" value="off" />}
            <input
              type="search"
              name="q"
              defaultValue={params.q}
              placeholder="Search sets, e.g. Ascended Heroes"
              aria-label="Search sets"
              className="h-10 min-w-0 flex-1 sm:flex-none sm:w-72 px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
            />
            <button
              type="submit"
              className="h-10 px-4 rounded-md text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Search
            </button>
          </form>
        )}
        {params.q && params.sets.length < MAX_COMPARE && (
          <ul className="mt-2 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
            {matches.length === 0 && (
              <li className="py-2 text-zinc-500">
                No set with prices matches &ldquo;{params.q}&rdquo;.
              </li>
            )}
            {matches
              .filter((m) => !chosen.has(m.groupId))
              .map((m) => (
                <li
                  key={m.groupId}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{m.name}</span>{" "}
                    <span className="text-xs text-zinc-500">
                      {m.language === "ja" ? "Japanese" : "English"} ·{" "}
                      {releaseLabel(m.releasedOn)}
                    </span>
                  </span>
                  <Link
                    href={here({ sets: [...params.sets, m.groupId], q: "" })}
                    className="shrink-0 text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                  >
                    Add
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Card>

      {sets.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-col gap-2">
            <Chips label="Value">
              {CARD_METRICS.map((m) => (
                <Chip key={m} href={here({ card: m })} on={params.card === m}>
                  {CARD_METRIC_LABELS[m]}
                </Chip>
              ))}
            </Chips>
            <Chips label="Measured from">
              {CARD_BASE_AGES.map((b) => (
                <Chip key={b} href={here({ base: b })} on={params.base === b}>
                  {BASE_LABELS[b]}
                </Chip>
              ))}
            </Chips>
            <Chips label="Typical range">
              <Chip href={here({ band: true })} on={params.band}>
                Show
              </Chip>
              <Chip href={here({ band: false })} on={!params.band}>
                Hide
              </Chip>
            </Chips>
          </div>

          {drawable ? (
            <>
              <div className="mt-4">
                <div className="hidden sm:block">
                  <CompareChart
                    lines={lines}
                    band={band}
                    baseAge={params.base}
                    size="wide"
                  />
                </div>
                <div className="sm:hidden">
                  <CompareChart
                    lines={lines}
                    band={band}
                    baseAge={params.base}
                    size="narrow"
                  />
                </div>
              </div>
              <Legend
                items={lines
                  .filter((l) => l.points.length > 1)
                  .map((l) => ({ label: l.label, stroke: l.stroke }))}
                note={
                  band && band.length > 1
                    ? `Grey band: the middle half of earlier ${bandLanguage === "ja" ? "Japanese" : "English"} sets (dashed line is their median), leaving out the ones above.`
                    : undefined
                }
              />
            </>
          ) : (
            <p className="mt-4 text-sm text-zinc-500 max-w-prose">
              None of these sets can be drawn from this starting age. See the
              reasons below, or try a later starting day.
            </p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-2 pr-2 text-left font-medium">Set</th>
                  <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
                    Now
                  </th>
                  {[30, 90, 180, 365].map((a) => (
                    <th
                      key={a}
                      className={`px-1.5 sm:px-3 py-2 text-right font-medium ${a === 90 || a === 365 ? "hidden sm:table-cell" : ""}`}
                    >
                      {a < 365 ? `${a}d` : "1y"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {sets.map((s, i) => {
                  const p = paths[i];
                  const latest = p[p.length - 1] ?? null;
                  const age =
                    s.releasedOn && s.days.length > 0
                      ? daysBetween(s.releasedOn, s.days[s.days.length - 1].day)
                      : null;
                  return (
                    <tr key={s.groupId}>
                      <td className="py-2 pr-2 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block h-2 w-2 shrink-0 rounded-full ${COMPARE_SWATCH[i % COMPARE_SWATCH.length]}`}
                          />
                          <Link
                            href={`/catalog/sets/${s.groupId}`}
                            className="font-medium hover:underline"
                          >
                            {s.name}
                          </Link>
                        </div>
                        <div className="text-[11px] text-zinc-500 ml-4">
                          {s.language === "ja" ? "Japanese" : "English"}
                          {s.releasedOn
                            ? ` · released ${releaseLabel(s.releasedOn)}`
                            : ""}
                          {age != null ? ` · ${ageLabel(age)}` : ""}
                        </div>
                        {p.length === 0 && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400 ml-4 mt-0.5 max-w-xs">
                            {whyNoPath(s, params.base)}
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-1.5 sm:px-3 py-2 text-right tabular-nums font-medium ${latest ? tone(latest.change) : ""}`}
                      >
                        {latest ? changeLabel(latest.change) : "—"}
                      </td>
                      {[30, 90, 180, 365].map((a) => {
                        const v = valueAt(p, a);
                        return (
                          <td
                            key={a}
                            className={`px-1.5 sm:px-3 py-2 text-right tabular-nums ${a === 90 || a === 365 ? "hidden sm:table-cell" : ""} ${v ? tone(v.change) : "text-zinc-400"}`}
                          >
                            {v ? changeLabel(v.change) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
            Change since{" "}
            {params.base === 0 ? "release day" : `day ${params.base}`}, at that
            many days after release. A day only counts when about as many of the
            set&apos;s cards were priced as on the starting day, because a
            set&apos;s value also grows when cards gain a price. A dash means
            the set hasn&apos;t reached that age yet.
          </p>
        </Card>
      )}
    </div>
  );
}
