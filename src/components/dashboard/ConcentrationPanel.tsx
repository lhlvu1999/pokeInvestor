"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import {
  concentrationRows,
  otherTagCount,
  type ConcentrationView,
  type TagCost,
} from "@/lib/calc/concentration";
import { formatCompactAmount } from "@/lib/currency";

const VISIBLE = 6;

const VIEWS: { id: ConcentrationView; label: string; hint: string }[] = [
  { id: "sets", label: "Sets", hint: "Money tied up in each set" },
  { id: "types", label: "Product types", hint: "Money tied up in each kind of product" },
  { id: "all", label: "All tags", hint: "Every tag, including your own labels" },
];

/**
 * Where the money in stock sits: a ranked list of bars, one per set (or kind of
 * product), each as a share of everything you hold, at cost. Click a row to see
 * those items.
 */
export function ConcentrationPanel({
  tags,
  portfolioCost,
  currency,
  setTags,
  oldNicknames,
}: {
  tags: TagCost[];
  /** Cost of everything held, so each share is of the whole portfolio. */
  portfolioCost: number;
  currency: string;
  /** Tags that are a catalogue set's name. */
  setTags: string[];
  /** Your own tags that could be renamed to their set's name. */
  oldNicknames: { tag: string; setTag: string }[];
}) {
  const setTagSet = useMemo(() => new Set(setTags), [setTags]);
  const hasSets = useMemo(
    () => concentrationRows(tags, portfolioCost, setTagSet, "sets").length > 0,
    [tags, portfolioCost, setTagSet],
  );
  const [view, setView] = useState<ConcentrationView>(hasSets ? "sets" : "all");
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(
    () => concentrationRows(tags, portfolioCost, setTagSet, view),
    [tags, portfolioCost, setTagSet, view],
  );
  const others = otherTagCount(tags, setTagSet);
  const shown = expanded ? rows : rows.slice(0, VISIBLE);
  const top = rows[0]?.share ?? 0;
  const covered = rows.reduce((s, r) => s + r.share, 0);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-medium text-sm">
            Concentration{" "}
            <span className="text-xs text-zinc-500 font-normal">where your stock money sits</span>
          </h2>
        </div>
        <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-800 p-0.5 text-xs">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              title={v.hint}
              onClick={() => {
                setView(v.id);
                setExpanded(false);
              }}
              className={`px-2.5 py-1 rounded ${
                view === v.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          {view === "sets"
            ? "No item is linked to a catalogue set yet. Link items to the catalogue and each set shows up here."
            : "Nothing to show for this view."}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {shown.map((r, i) => (
            <li key={r.tag}>
              <Link
                href={`/items?tags=${encodeURIComponent(r.tag)}`}
                className="group block rounded-md px-2 py-1.5 -mx-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-zinc-400 tabular-nums mr-2 text-xs">{i + 1}</span>
                    <span className="font-medium group-hover:underline">{r.tag}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-zinc-500">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {formatCompactAmount(r.cost, currency)}
                    </span>{" "}
                    · {r.share >= 0.1 ? Math.round(r.share * 100) : (r.share * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-sky-500/80 group-hover:bg-sky-500"
                    style={{ width: `${Math.max(2, (r.share / top) * 100)}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  {r.held} unit{r.held === 1 ? "" : "s"} held
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {rows.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-xs text-sky-700 dark:text-sky-400 hover:underline"
        >
          {expanded ? "Show fewer" : `Show ${rows.length - VISIBLE} more`}
        </button>
      )}

      {rows.length > 0 && view !== "all" && (
        <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
          Together these cover {Math.round(Math.min(1, covered) * 100)}% of what you hold, at cost.
          {view === "sets" && others > 0 && covered < 0.97 ? " The rest is in items with no set tag." : ""}
        </p>
      )}
      {view === "all" && rows.length > 0 && (
        <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
          An item can carry several tags, so these shares add up to more than 100%.
        </p>
      )}

      {oldNicknames.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-300/70 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs leading-relaxed">
          <span className="text-amber-800 dark:text-amber-300">
            {oldNicknames.length} of your tags {oldNicknames.length === 1 ? "is" : "are"} old nicknames for a set
          </span>{" "}
          <span className="text-zinc-600 dark:text-zinc-400">
            (like <b>{oldNicknames[0].tag}</b> for {oldNicknames[0].setTag}), so a set can show up twice.
          </span>{" "}
          <Link href="/items/tags" className="text-sky-700 dark:text-sky-400 hover:underline whitespace-nowrap">
            Merge them into set names →
          </Link>
        </div>
      )}
    </Card>
  );
}
