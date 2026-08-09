"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setItemAliases } from "@/lib/server/items";

/**
 * Chip-input editor for `items.aliases`. Mirrors TagEditor but with
 * different copy + no autocomplete (aliases are item-specific, not shared
 * vocabulary).
 *
 * Aliases are the alternate names YouTube creators use for the same
 * product. The pipeline matcher checks `name` then `aliases` — resolving a
 * raw name here once means future mentions auto-link forever.
 */
export function AliasEditor({
  itemId,
  initialAliases,
}: {
  itemId: string;
  initialAliases: string[];
}) {
  const router = useRouter();
  const [aliases, setAliases] = useState<string[]>(initialAliases);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function commit(next: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await setItemAliases(itemId, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAliases(res.data);
      router.refresh();
    });
  }

  function addAlias(raw: string) {
    const a = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!a) return;
    if (aliases.includes(a)) {
      setDraft("");
      return;
    }
    if (aliases.length >= 30) {
      setError("Up to 30 aliases per item.");
      return;
    }
    if (a.length > 120) {
      setError("Alias must be 120 characters or fewer.");
      return;
    }
    const next = [...aliases, a];
    setDraft("");
    commit(next);
  }

  function removeAlias(a: string) {
    commit(aliases.filter((x) => x !== a));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addAlias(draft);
    } else if (e.key === "Backspace" && draft === "" && aliases.length > 0) {
      removeAlias(aliases[aliases.length - 1]);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-xs uppercase tracking-wider text-zinc-500 font-medium">
          Aliases
        </div>
        <div className="text-[10px] text-zinc-400">
          Alternate names creators use for this item. Helps the matcher
          auto-link future mentions.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {aliases.map((a) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-700 dark:text-zinc-200"
          >
            <span>{a}</span>
            <button
              type="button"
              onClick={() => removeAlias(a)}
              disabled={pending}
              className="opacity-60 hover:opacity-100"
              aria-label={`Remove alias ${a}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) addAlias(draft);
          }}
          placeholder={aliases.length === 0 ? "e.g. destined rivals etb" : "Add alias..."}
          disabled={pending}
          className="text-xs h-7 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 min-w-[160px]"
        />
      </div>
      {error && (
        <div className="text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}
    </div>
  );
}
