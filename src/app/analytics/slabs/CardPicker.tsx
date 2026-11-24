"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  chooseRawCard,
  searchRawCards,
  type CardHit,
} from "@/lib/server/slab_actions";
import { ItemThumb } from "@/components/ItemThumb";

/** "Choose card": look a card up by name or number and match this slab to it. */
export function CardPicker({ id, hint }: { id: string; hint: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(hint);
  const [hits, setHits] = useState<CardHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function search() {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await searchRawCards(query);
      if (!res.ok) setError(res.error);
      else setHits(res.data);
    });
  }

  function choose(hit: CardHit) {
    setError(null);
    start(async () => {
      const res = await chooseRawCard(id, hit.productId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote(
        res.data.priceStored
          ? null
          : "Matched. Its price appears after the next daily sync.",
      );
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-sky-700 dark:text-sky-400 hover:underline underline-offset-2"
      >
        Choose card
        {note && <span className="ml-2 text-zinc-500">{note}</span>}
      </button>
    );
  }

  return (
    <div className="mt-1 w-full max-w-md rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 text-xs">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Card name or number"
          placeholder="Name or number, e.g. eevee 173"
          disabled={pending}
          className="h-8 min-w-0 flex-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-xs"
        />
        <button
          type="submit"
          disabled={pending || query.trim() === ""}
          className="h-8 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending && !hits ? "Searching…" : "Search"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-zinc-500 hover:underline"
        >
          Cancel
        </button>
      </form>
      {error && <p className="mt-2 text-rose-600 dark:text-rose-400">{error}</p>}
      {hits && hits.length === 0 && (
        <p className="mt-2 text-zinc-500">No card matches every word. Try fewer words.</p>
      )}
      {hits && hits.length > 0 && (
        <ul className="mt-2 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {hits.map((h) => (
            <li key={h.productId} className="flex items-center gap-2 py-1.5">
              <ItemThumb imageUrl={h.imageUrl} name={h.name} size={32} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{h.name}</span>
                <span className="block text-[11px] text-zinc-500">
                  {`${h.number ?? "no number"} · ${h.setName} · ${h.language === "ja" ? "Japanese" : "English"}`}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => choose(h)}
                className="shrink-0 rounded-md bg-zinc-900 px-2.5 h-7 text-[11px] font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
              >
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
