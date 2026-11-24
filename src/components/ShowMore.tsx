"use client";

import { windowLabel, type RowWindow } from "@/lib/calc/row_window";

/** Under a windowed list: how many are shown, and buttons to show more. */
export function ShowMore({
  window: w,
  noun,
  pageSize,
  onMore,
  onAll,
}: {
  window: RowWindow;
  noun: string;
  pageSize: number;
  onMore: () => void;
  onAll: () => void;
}) {
  const label = windowLabel(w, noun);
  if (!label) return null;
  const next = Math.min(pageSize, w.total - w.shown);
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 py-2 text-sm text-zinc-500">
      <span>{label}</span>
      <button
        type="button"
        onClick={onMore}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 h-8 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {`Show ${next.toLocaleString("en-US")} more`}
      </button>
      <button type="button" onClick={onAll} className="text-xs hover:underline">
        Show all
      </button>
    </div>
  );
}
