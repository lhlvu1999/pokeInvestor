"use client";

/**
 * Header typeahead. Cmd/Ctrl+K focuses; typing 2+ chars triggers a
 * debounced call to `searchItems`; arrow keys navigate, Enter jumps
 * to /items/[id]. Kept intentionally small — no framework, no fetch
 * cache, just useState + a router.push.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchItems, type SearchHit } from "@/lib/server/search";
import { ItemThumb } from "./ItemThumb";

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl+K global focus shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on click outside.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced search — 150ms feels responsive without hammering the DB.
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const rows = await searchItems(q);
        setHits(rows);
        setActive(0);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [q]);

  function pick(hit: SearchHit) {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(`/items/${hit.id}`);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const hit = hits[active];
      if (hit) {
        e.preventDefault();
        pick(hit);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-xs">
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKey}
        placeholder="Search items… (⌘K)"
        className="w-full h-9 px-3 pr-8 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700"
        autoComplete="off"
        spellCheck={false}
      />
      {loading && (
        <span
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400"
          aria-hidden="true"
        >
          …
        </span>
      )}

      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 mt-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg max-h-80 overflow-y-auto z-20">
          {hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">
              {loading ? "Searching…" : "No matches."}
            </div>
          ) : (
            <ul>
              {hits.map((h, i) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => pick(h)}
                    onMouseEnter={() => setActive(i)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 text-sm ${
                      i === active
                        ? "bg-zinc-100 dark:bg-zinc-800"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <ItemThumb imageUrl={h.imageUrl} name={h.name} size={28} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{h.name}</div>
                      {(h.setCode || h.cardNumber) && (
                        <div className="text-[11px] text-zinc-500 truncate">
                          {[h.setCode, h.cardNumber]
                            .filter(Boolean)
                            .join(" • ")}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
