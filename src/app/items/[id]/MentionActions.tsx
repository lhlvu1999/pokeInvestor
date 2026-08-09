"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  relinkMention,
  searchItemsForLink,
  unlinkMention,
  type ItemPick,
} from "@/lib/server/insights";

type Mode = "idle" | "moving" | "confirmingUnlink";

/**
 * Inline action affordances rendered on each mention row inside
 * `ItemInsights`. Two operations:
 *  - Move to another item: opens an item-search picker, with an
 *    optional "remember this raw name as an alias on the new item"
 *    checkbox so the matcher catches the next occurrence automatically.
 *  - Unlink: returns the mention to the unmatched pool so it shows up
 *    in /admin/mentions for re-resolution.
 */
export function MentionActions({
  mentionId,
  rawName,
}: {
  mentionId: string;
  rawName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [query, setQuery] = useState(rawName);
  const [options, setOptions] = useState<ItemPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [rememberAlias, setRememberAlias] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function doSearch(value: string) {
    setQuery(value);
    setError(null);
    if (value.trim().length === 0) {
      setOptions([]);
      return;
    }
    setSearching(true);
    try {
      setOptions(await searchItemsForLink(value));
    } finally {
      setSearching(false);
    }
  }

  function performMove(newItemId: string) {
    setError(null);
    startTransition(async () => {
      const res = await relinkMention({
        mentionId,
        newItemId,
        rememberAlias,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function performUnlink() {
    setError(null);
    startTransition(async () => {
      const res = await unlinkMention(mentionId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (mode === "idle") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <button
          type="button"
          onClick={() => {
            setMode("moving");
            // Start with an empty result list — user types or accepts default.
            void doSearch(rawName);
          }}
          className="hover:text-zinc-900 dark:hover:text-zinc-100 hover:underline underline-offset-2"
        >
          Move
        </button>
        <span className="text-zinc-300 dark:text-zinc-700">·</span>
        <button
          type="button"
          onClick={() => setMode("confirmingUnlink")}
          className="hover:text-rose-600 dark:hover:text-rose-400 hover:underline underline-offset-2"
        >
          Unlink
        </button>
      </div>
    );
  }

  if (mode === "confirmingUnlink") {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-zinc-500">Send back to unmatched?</span>
        <button
          type="button"
          onClick={performUnlink}
          disabled={pending}
          className="text-rose-700 dark:text-rose-300 hover:underline underline-offset-2"
        >
          {pending ? "Unlinking..." : "Yes"}
        </button>
        <button
          type="button"
          onClick={() => setMode("idle")}
          disabled={pending}
          className="text-zinc-500 hover:underline underline-offset-2"
        >
          Cancel
        </button>
        {error && (
          <span className="text-rose-600 dark:text-rose-400">{error}</span>
        )}
      </div>
    );
  }

  // mode === "moving"
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 p-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => doSearch(e.target.value)}
          placeholder="Search items..."
          autoFocus
          className="h-7 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs flex-1"
        />
        <button
          type="button"
          onClick={() => setMode("idle")}
          className="text-[11px] text-zinc-500 hover:underline"
        >
          Cancel
        </button>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-300 select-none">
        <input
          type="checkbox"
          checked={rememberAlias}
          onChange={(e) => setRememberAlias(e.target.checked)}
          className="w-3.5 h-3.5"
        />
        Remember{" "}
        <span className="italic">&quot;{rawName}&quot;</span> as an alias on the
        picked item
      </label>
      {searching && (
        <div className="text-[11px] text-zinc-500">Searching…</div>
      )}
      {!searching && options.length > 0 && (
        <ul className="flex flex-col rounded border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 max-h-48 overflow-auto">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => performMove(o.id)}
                disabled={pending}
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                <span className="font-medium">{o.name}</span>
                {o.setCode && (
                  <span className="text-zinc-500 ml-2">({o.setCode})</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching && query.trim().length > 0 && options.length === 0 && (
        <div className="text-[11px] text-zinc-500">
          No items match — try a different search.
        </div>
      )}
      {error && (
        <div className="text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}
    </div>
  );
}
