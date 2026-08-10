"use client";

/**
 * Typeahead item picker for the transaction form. Replaces the old giant
 * <select>. When the typed text doesn't match any existing item, offers
 * "Create '{typed}' as new item" as the last dropdown option — on select,
 * it POSTs to createItem, then adopts the returned id.
 *
 * Exposes the selection via a hidden `<input name="itemId">` so the parent
 * form can read it via FormData without prop-drilling state.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createItem } from "@/lib/server/items";
import { useToast } from "@/components/Toast";

export type PickerOption = {
  id: string;
  name: string;
  currency: string; // from most-recent tx; used to warn on mismatch
  held: number;
};

type Props = {
  items: PickerOption[];
  value: string;
  onChange: (id: string) => void;
  /** Disables the picker and shows the current selection read-only. */
  locked?: boolean;
};

const MAX_HITS = 8;

export function ItemPicker({ items, value, onChange, locked }: Props) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, startCreate] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => items.find((it) => it.id === value) ?? null,
    [items, value],
  );

  // When a selection changes externally (e.g. after inline create) reset the
  // typed text so the input shows the picked item's name.
  useEffect(() => {
    if (selected) setQ(selected.name);
  }, [selected]);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items.slice(0, MAX_HITS);
    // Prefix hits first, then substring, then shortest name.
    return items
      .filter((it) => it.name.toLowerCase().includes(term))
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(term) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(term) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.name.length - b.name.length;
      })
      .slice(0, MAX_HITS);
  }, [items, q]);

  const trimmed = q.trim();
  const exactExists =
    trimmed.length > 0 &&
    items.some((it) => it.name.toLowerCase() === trimmed.toLowerCase());
  const showCreate = trimmed.length >= 2 && !exactExists;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    // Re-focus after Enter/click to keep the user's flow in the form.
    inputRef.current?.blur();
  }

  function createNew() {
    if (!trimmed) return;
    startCreate(async () => {
      const res = await createItem({ name: trimmed });
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      toast.show({
        kind: "success",
        message: `Created "${res.data.name}"`,
      });
      onChange(res.data.id);
      setOpen(false);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const total = hits.length + (showCreate ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(total - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < hits.length) {
        pick(hits[active].id);
      } else if (showCreate) {
        createNew();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  if (locked && selected) {
    return (
      <>
        <input type="hidden" name="itemId" value={selected.id} />
        <div className="h-10 flex items-center px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-sm text-zinc-500">
          {selected.name}
        </div>
      </>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <input type="hidden" name="itemId" value={value} />
      <input
        ref={inputRef}
        type="text"
        value={q}
        placeholder="Type to search, or type a new name…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
          // Typing clears any locked selection so the user can pick fresh.
          if (value) onChange("");
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
        className="h-10 w-full px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700"
      />
      {selected && (
        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
          ✓ {selected.name} — {selected.held} held ({selected.currency})
        </div>
      )}

      {open && (
        <div className="absolute left-0 right-0 mt-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg max-h-72 overflow-y-auto z-20">
          {hits.length === 0 && !showCreate && (
            <div className="px-3 py-2 text-xs text-zinc-500">
              Type to search items…
            </div>
          )}
          <ul>
            {hits.map((it, i) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => pick(it.id)}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm ${
                    i === active
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  <span className="truncate">{it.name}</span>
                  <span className="text-[11px] text-zinc-500 whitespace-nowrap">
                    {it.held} held · {it.currency}
                  </span>
                </button>
              </li>
            ))}
            {showCreate && (
              <li>
                <button
                  type="button"
                  onClick={createNew}
                  onMouseEnter={() => setActive(hits.length)}
                  disabled={creating}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm border-t border-zinc-200 dark:border-zinc-800 ${
                    active === hits.length
                      ? "bg-emerald-100 dark:bg-emerald-950/40"
                      : "hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  }`}
                >
                  <span className="text-emerald-600 dark:text-emerald-400">
                    +
                  </span>
                  <span>
                    {creating ? "Creating…" : `Create "${trimmed}" as new item`}
                  </span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
