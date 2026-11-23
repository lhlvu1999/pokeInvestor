"use client";

import { useState, type ReactNode } from "react";

/**
 * A `<tbody>` that shows its first rows and tucks the rest behind a
 * toggle, so a 40-row table doesn't push everything below it off-screen.
 *
 * Both halves arrive as pre-rendered server markup, so the hidden rows
 * still cost nothing client-side beyond being held in the payload. Nothing
 * is removed — "Show all" restores every row.
 */
export function CollapsibleRows({
  visible,
  hidden,
  hiddenCount,
  colSpan,
  noun = "rows",
}: {
  visible: ReactNode;
  hidden: ReactNode;
  hiddenCount: number;
  colSpan: number;
  noun?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
      {visible}
      {open && hidden}
      {hiddenCount > 0 && (
        <tr>
          <td colSpan={colSpan} className="px-4 py-2.5 text-center">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {open ? "Show fewer" : `Show ${hiddenCount} more ${noun}`}
            </button>
          </td>
        </tr>
      )}
    </tbody>
  );
}
