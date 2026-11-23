"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const DEFAULT_VISIBLE = 8;

export type CashflowTagChip = {
  tag: string;
  href: string;
  active: boolean;
};

/**
 * The cashflow range lives in the URL but is changed client-side, so the
 * server-rendered hrefs below don't know about it. Re-attach the current
 * range when a chip is clicked so filtering by tag doesn't reset the window.
 */
const RANGE_PARAMS = ["cf", "cffrom", "cfto"] as const;

function withCurrentRange(href: string): string {
  const current = new URLSearchParams(window.location.search);
  const target = new URL(href, window.location.origin);
  for (const k of RANGE_PARAMS) {
    const v = current.get(k);
    if (v != null) target.searchParams.set(k, v);
  }
  return `${target.pathname}${target.search}`;
}

export function CashflowTagFilter({
  chips,
  activeCount,
  clearHref,
}: {
  /** Pre-computed chips from the server (functions can't cross the RSC boundary). */
  chips: CashflowTagChip[];
  /** Number of active chips, used to decide whether to show "clear". */
  activeCount: number;
  /** URL for the "clear" link (no filter). */
  clearHref: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const go = (e: React.MouseEvent, href: string) => {
    // Let modified clicks (new tab etc.) use the plain href.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    router.push(withCurrentRange(href), { scroll: false });
  };

  if (chips.length === 0) return null;

  // Active chips first, then inactive — so active never get hidden when collapsed.
  const ordered = [
    ...chips.filter((c) => c.active),
    ...chips.filter((c) => !c.active),
  ];
  const visible = expanded ? ordered : ordered.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = ordered.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      <span className="text-xs text-zinc-500 mr-1">Filter:</span>
      {visible.map((c) => (
        <Link
          key={c.tag}
          href={c.href}
          onClick={(e) => go(e, c.href)}
          className={`text-[10px] rounded-full px-2 py-0.5 border transition-colors ${
            c.active
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          {c.tag}
        </Link>
      ))}
      {hiddenCount > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[10px] rounded-full px-2 py-0.5 border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          +{hiddenCount} more
        </button>
      )}
      {expanded && ordered.length > DEFAULT_VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[10px] text-zinc-500 hover:underline ml-1"
        >
          Show less
        </button>
      )}
      {activeCount > 0 && (
        <Link
          href={clearHref}
          onClick={(e) => go(e, clearHref)}
          className="text-[10px] text-zinc-500 hover:underline ml-1"
        >
          clear
        </Link>
      )}
    </div>
  );
}
