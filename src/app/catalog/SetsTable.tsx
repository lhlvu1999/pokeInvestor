"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, Checkbox, Select, TextInput } from "@/components/ui";
import {
  changeLabel,
  DEFAULT_SET_QUERY,
  filterAndSortSets,
  releaseLabel,
  SORT_LABELS,
  type SetLanguageFilter,
  type SetSort,
} from "@/lib/calc/set_list";
import type { SetListRow } from "@/lib/server/catalog_sets";
import { showUsd, type Fx } from "@/lib/calc/catalog_money";

const LANGS: { value: SetLanguageFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
];

/** Page through long lists rather than render 685 rows at once. */
const PAGE = 60;

export function SetsTable({ rows, fx }: { rows: SetListRow[]; fx: Fx | null }) {
  const [language, setLanguage] = useState<SetLanguageFilter>("all");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<SetSort>("newest");
  const [onlyPriced, setOnlyPriced] = useState(DEFAULT_SET_QUERY.onlyPriced);
  const [onlyMine, setOnlyMine] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const anyMine = rows.some((r) => r.yourItems > 0);
  const result = useMemo(
    () =>
      filterAndSortSets(rows, { language, text, sort, onlyPriced, onlyMine }),
    [rows, language, text, sort, onlyPriced, onlyMine],
  );
  // Whenever the filters change, start from the top of the list again.
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setShown(PAGE);
    };
  const visible = result.slice(0, shown);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Language"
          className="inline-flex rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden"
        >
          {LANGS.map((l) => (
            <button
              key={l.value}
              type="button"
              aria-pressed={language === l.value}
              onClick={() => reset(setLanguage)(l.value)}
              className={`h-10 px-3.5 text-sm ${
                language === l.value
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <TextInput
          type="search"
          placeholder="Search sets…"
          value={text}
          onChange={(e) => reset(setText)(e.target.value)}
          className="min-w-0 flex-1 sm:flex-none sm:w-64"
        />
        <Select
          value={sort}
          onChange={(e) => reset(setSort)(e.target.value as SetSort)}
          aria-label="Sort by"
        >
          {(Object.keys(SORT_LABELS) as SetSort[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox
            checked={onlyPriced}
            onChange={(e) => reset(setOnlyPriced)(e.target.checked)}
          />
          Only sets with prices
        </label>
        {anyMine && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Checkbox
              checked={onlyMine}
              onChange={(e) => reset(setOnlyMine)(e.target.checked)}
            />
            Sets I hold
          </label>
        )}
        <span className="text-xs text-zinc-500 sm:ml-auto">
          {result.length === rows.length
            ? `${rows.length} sets`
            : `${result.length} of ${rows.length} sets`}
        </span>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Set</th>
              <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">
                Released
              </th>
              <th className="px-3 py-2 text-right font-medium hidden md:table-cell">
                Sealed
              </th>
              <th className="px-3 py-2 text-right font-medium">Set value</th>
              <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">
                Top 20
              </th>
              <th
                className="px-4 py-2 text-right font-medium hidden md:table-cell"
                title="Change in set value over about a month. Needs a month of history."
              >
                1 month
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visible.map((r) => (
              <tr
                key={r.groupId}
                className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              >
                <td className="px-4 py-2.5">
                  <Link
                    href={`/catalog/sets/${r.groupId}`}
                    className="font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="text-xs text-zinc-500 flex items-center gap-1.5">
                    <span>{r.language === "ja" ? "Japanese" : "English"}</span>
                    {r.yourItems > 0 && (
                      <span className="rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 px-1.5 text-[10px] font-medium">
                        you hold {r.yourItems}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-zinc-500 hidden sm:table-cell whitespace-nowrap">
                  {releaseLabel(r.publishedOn)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500 hidden md:table-cell">
                  {r.sealedCount}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                  <Amount
                    cents={r.totalCents}
                    priced={r.pricedCount > 0}
                    fx={fx}
                  />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500 hidden sm:table-cell whitespace-nowrap">
                  <Amount
                    cents={r.top20Cents}
                    priced={r.pricedCount > 0}
                    fx={fx}
                  />
                </td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums hidden md:table-cell ${
                    r.changePct == null
                      ? "text-zinc-400"
                      : r.changePct > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : r.changePct < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-zinc-500"
                  }`}
                >
                  {changeLabel(r.changePct)}
                </td>
              </tr>
            ))}
            {result.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  No sets match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {result.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="self-center rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 h-10 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Show {Math.min(PAGE, result.length - shown)} more (
          {result.length - shown} left)
        </button>
      )}
    </div>
  );
}

/** A compact amount in the display currency, with the dollars on hover. */
function Amount({
  cents,
  priced,
  fx,
}: {
  cents: number;
  priced: boolean;
  fx: Fx | null;
}) {
  if (!priced) return <>—</>;
  const shown = showUsd(cents, fx, true);
  const exact = showUsd(cents, fx, false);
  return (
    <span
      title={
        exact.secondary
          ? `${exact.secondary} (${exact.primary})`
          : exact.primary
      }
    >
      {shown.primary}
    </span>
  );
}
