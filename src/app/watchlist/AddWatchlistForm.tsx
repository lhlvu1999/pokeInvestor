"use client";

/**
 * Add-to-watchlist form. Item link is optional — a floating entry
 * (typed name only) is still useful for products you haven't added to
 * inventory yet, and signals fuzzy-match on the name.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addWatchlistItem } from "@/lib/server/watchlist";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { DEFAULT_TRANSACTION_CURRENCY } from "@/lib/currency";
import { useToast } from "@/components/Toast";

export type ExistingItem = { id: string; name: string };

export function AddWatchlistForm({
  existingItems,
  defaultCurrency,
}: {
  existingItems: ExistingItem[];
  defaultCurrency?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [currency, setCurrency] = useState(
    defaultCurrency ?? DEFAULT_TRANSACTION_CURRENCY,
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  const linkedItem = useMemo(
    () => existingItems.find((i) => i.id === itemId) ?? null,
    [existingItems, itemId],
  );

  const itemMatches = useMemo(() => {
    const term = itemQuery.trim().toLowerCase();
    if (!term) return existingItems.slice(0, 6);
    return existingItems
      .filter((i) => i.name.toLowerCase().includes(term))
      .slice(0, 6);
  }, [existingItems, itemQuery]);

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Product name is required.");
      return;
    }
    startTransition(async () => {
      const res = await addWatchlistItem({
        name,
        itemId: itemId ?? "",
        targetBuyPrice: targetPrice,
        currency,
        note,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.show({
        kind: "success",
        message: `Added "${res.data.name}" to watchlist`,
      });
      // Reset form state so the user can add another without navigating.
      setName("");
      setItemId(null);
      setItemQuery("");
      setTargetPrice("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-3 bg-white dark:bg-zinc-950">
      <h2 className="font-medium text-sm">Add to watchlist</h2>

      <div>
        <label className="text-[11px] uppercase tracking-wider text-zinc-500">
          Product name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Journey Together ETB"
          className="mt-1 w-full h-10 px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
        />
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-wider text-zinc-500">
          Link to existing item (optional)
        </label>
        {linkedItem ? (
          <div className="mt-1 flex items-center justify-between gap-2 h-10 px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-sm">
            <span>{linkedItem.name}</span>
            <button
              type="button"
              onClick={() => {
                setItemId(null);
                setItemQuery("");
              }}
              className="text-xs text-zinc-500 hover:underline"
            >
              unlink
            </button>
          </div>
        ) : showItemPicker ? (
          <div className="mt-1">
            <input
              ref={pickerRef}
              type="text"
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
              placeholder="Search items…"
              className="w-full h-10 px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
              autoFocus
            />
            {itemMatches.length > 0 && (
              <div className="mt-1 border border-zinc-200 dark:border-zinc-800 rounded max-h-40 overflow-y-auto">
                {itemMatches.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => {
                      setItemId(it.id);
                      setShowItemPicker(false);
                      if (!name.trim()) setName(it.name);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {it.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowItemPicker(true)}
            className="mt-1 text-xs text-zinc-500 hover:underline"
          >
            + Link an existing item
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500">
            Target buy price (optional)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            placeholder="0"
            className="mt-1 w-full h-10 px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
          />
          <div className="text-[10px] text-zinc-500 mt-0.5">
            Shorthand: <code>5m</code>, <code>2.5k</code>
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500">
            Currency
          </label>
          <CurrencyPicker
            id="wl-currency"
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-wider text-zinc-500">
          Why you want it (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. Ash Ketchum LGD in this set — low print run"
          className="mt-1 w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
        />
      </div>

      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim()}
          className="inline-flex items-center justify-center rounded-md px-4 h-10 text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
