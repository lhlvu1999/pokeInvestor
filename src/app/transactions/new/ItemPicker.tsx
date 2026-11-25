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
import { formatAmount } from "@/lib/currency";
import type { CatalogHit } from "@/lib/server/catalog_search";
import { useCatalogueSearch } from "@/components/useCatalogueSearch";
import { CatalogueHitLabel } from "@/components/CatalogueHitLabel";
import { ItemThumb } from "@/components/ItemThumb";

export type PickerOption = {
  id: string;
  name: string;
  imageUrl?: string | null;
  currency: string; // from most-recent tx; used to warn on mismatch
  held: number;
  /** Latest market price per unit in `currency`, if known. */
  marketMinor?: number | null;
  /** The catalogue set this item is linked to, if any. */
  setName?: string | null;
};

type Props = {
  items: PickerOption[];
  value: string;
  onChange: (id: string) => void;
  /** Disables the picker and shows the current selection read-only. */
  locked?: boolean;
  /**
   * Bump this to clear the search text and move the cursor into the box —
   * used by "save & add another" to start the next entry.
   */
  focusSignal?: number;
};

const MAX_HITS = 8;

export function ItemPicker({
  items,
  value,
  onChange,
  locked,
  focusSignal = 0,
}: Props) {
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

  // Derived-state adjustments happen during render, not in effects: React
  // re-renders immediately with the corrected state and no extra paint.
  //
  // 1) When a selection changes externally (e.g. after inline create), show
  //    the picked item's name in the box.
  const [seenSelectedId, setSeenSelectedId] = useState(selected?.id ?? null);
  if ((selected?.id ?? null) !== seenSelectedId) {
    setSeenSelectedId(selected?.id ?? null);
    if (selected) setQ(selected.name);
  }
  // 2) "Save & add another" bumps focusSignal to start the next entry:
  //    clear the search text (the cursor move is a DOM effect, below).
  const [seenSignal, setSeenSignal] = useState(focusSignal);
  if (seenSignal !== focusSignal) {
    setSeenSignal(focusSignal);
    setQ("");
    setOpen(false);
  }
  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

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
  // Catalogue products the typed name could be: creating from one links the new
  // item to its set straight away.
  const catHits = useCatalogueSearch(trimmed, showCreate && !locked && open).slice(0, 4);

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
      // A clear catalogue match is linked automatically; otherwise it stays unlinked.
      const res = await createItem({ name: trimmed, autoLink: true });
      finishCreate(res);
    });
  }

  function createFromCatalogue(hit: CatalogHit) {
    startCreate(async () => {
      const res = await createItem({
        name: hit.name,
        catalogProductId: hit.productId,
        setCode: hit.setAbbreviation ?? "",
        cardNumber: hit.cardNumber ?? "",
      });
      finishCreate(res);
    });
  }

  function finishCreate(res: Awaited<ReturnType<typeof createItem>>) {
    if (!res.ok) {
      toast.show({ kind: "error", message: res.error });
      return;
    }
    const link = res.data.link;
    toast.show({
      kind: "success",
      message: link
        ? `Created "${res.data.name}" and linked it to ${link.productName} (${link.setName}).`
        : `Created "${res.data.name}". It isn't linked to the catalogue yet.`,
    });
    onChange(res.data.id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const total = hits.length + (showCreate ? 1 : 0) + catHits.length;
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
      } else if (showCreate && active === hits.length) {
        createNew();
      } else if (catHits[active - hits.length - 1]) {
        createFromCatalogue(catHits[active - hits.length - 1]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  if (locked && selected) {
    return (
      <>
        <input type="hidden" name="itemId" value={selected.id} />
        <div className="h-12 flex items-center gap-3 px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-sm text-zinc-500">
          <ItemThumb imageUrl={selected.imageUrl ?? null} name={selected.name} size={32} />
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
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          <ItemThumb imageUrl={selected.imageUrl ?? null} name={selected.name} size={36} />
          <span>
            ✓ {selected.name} — {selected.held} held ({selected.currency})
            {selected.setName ? ` · ${selected.setName}` : ""}
          </span>
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
                  className={`w-full text-left px-3 py-2 flex items-center gap-3 text-sm ${
                    i === active
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  <ItemThumb imageUrl={it.imageUrl ?? null} name={it.name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it.name}</span>
                    {it.setName && (
                      <span className="block text-[11px] text-zinc-500 truncate">{it.setName}</span>
                    )}
                  </span>
                  <span className="text-[11px] text-zinc-500 whitespace-nowrap text-right">
                    {it.held} held
                    {it.marketMinor != null && it.marketMinor > 0
                      ? ` · ${formatAmount(it.marketMinor, it.currency)}`
                      : ` · ${it.currency}`}
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
            {showCreate &&
              catHits.map((h, k) => (
                <li key={h.productId}>
                  <button
                    type="button"
                    onClick={() => createFromCatalogue(h)}
                    onMouseEnter={() => setActive(hits.length + 1 + k)}
                    disabled={creating}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm ${
                      active === hits.length + 1 + k
                        ? "bg-emerald-100 dark:bg-emerald-950/40"
                        : "hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    }`}
                  >
                    <span className="text-emerald-600 dark:text-emerald-400">+</span>
                    <span className="min-w-0">
                      <span className="block text-[11px] text-zinc-500">
                        Create from the catalogue and link to its set
                      </span>
                      <CatalogueHitLabel hit={h} />
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
