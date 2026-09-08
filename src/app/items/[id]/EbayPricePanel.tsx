"use client";

/**
 * eBay price refresh for a single item.
 *
 * Deliberately shows more than a number. eBay full-text search always
 * returns *something*, so a bad name match produces a confident-looking
 * wrong price. The panel therefore surfaces the confidence grade, the
 * exact query used, and the cheapest matched listing titles — the fastest
 * way for a human to spot "that's not my product". Low-confidence results
 * are not saved unless the user explicitly accepts them.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  refreshPriceFromEbay,
  setEbayQuery,
  type EbayRefreshResult,
} from "@/lib/server/prices";
import { formatAmount } from "@/lib/currency";
import { useToast } from "@/components/Toast";

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  low: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

export function EbayPricePanel({
  itemId,
  initialQuery,
}: {
  itemId: string;
  initialQuery: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<EbayRefreshResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editingQuery, setEditingQuery] = useState(false);
  const [query, setQuery] = useState(initialQuery ?? "");
  // Sealed product is the common case; slabs and used items need this off.
  const [newOnly, setNewOnly] = useState(true);

  function run(acceptLowConfidence = false) {
    setErr(null);
    startTransition(async () => {
      const res = await refreshPriceFromEbay(itemId, {
        acceptLowConfidence,
        newOnly,
      });
      if (!res.ok) {
        setErr(res.error);
        setResult(null);
        return;
      }
      setResult(res.data);
      if (!res.data.skipped) {
        toast.show({
          kind: "success",
          message: `Saved ${formatAmount(res.data.priceCents, res.data.currency)} from eBay`,
        });
        router.refresh();
      }
    });
  }

  function saveQuery() {
    startTransition(async () => {
      const res = await setEbayQuery(itemId, query);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setEditingQuery(false);
      toast.show({
        kind: "success",
        message: query.trim()
          ? "Custom eBay query saved"
          : "Custom query cleared",
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-md px-3 h-9 text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Checking eBay…" : "Refresh from eBay"}
        </button>
        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={newOnly}
            onChange={(e) => setNewOnly(e.target.checked)}
            className="accent-zinc-900 dark:accent-zinc-100"
          />
          Sealed / new only
        </label>
      </div>

      <div className="text-[10px] text-zinc-500">
        Uses eBay <strong>asking</strong> prices (sold-price data requires a
        separate eBay approval). Estimate is a low percentile of comparable
        active listings.
      </div>

      {err && (
        <div className="text-xs text-rose-600 dark:text-rose-400">{err}</div>
      )}

      {result && (
        <div className="rounded border border-zinc-200 dark:border-zinc-800 p-2.5 flex flex-col gap-2 bg-zinc-50 dark:bg-zinc-900/50">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-lg font-semibold tabular-nums">
              {formatAmount(result.priceCents, result.currency)}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 font-medium ${
                CONFIDENCE_STYLE[result.confidence]
              }`}
            >
              {result.confidence} confidence
            </span>
            {result.skipped && (
              <span className="text-[11px] text-rose-600 dark:text-rose-400">
                not saved
              </span>
            )}
          </div>

          <div className="text-[11px] text-zinc-500 tabular-nums">
            {result.sampleSize} listings sampled · {result.trimmedCount}{" "}
            outliers trimmed · spread {(result.dispersion * 100).toFixed(0)}% ·{" "}
            {result.totalMatching.toLocaleString()} total matches
            {result.rawCurrency !== result.currency && (
              <>
                {" · "}
                {formatAmount(result.rawMinor, result.rawCurrency)} before FX
              </>
            )}
          </div>

          {result.samples.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                Cheapest matches — check these are your product
              </div>
              {result.samples.slice(0, 3).map((s, i) => (
                <div
                  key={i}
                  className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate"
                >
                  <span className="tabular-nums mr-1.5">
                    {formatAmount(s.totalMinor, result.rawCurrency)}
                  </span>
                  {s.itemWebUrl ? (
                    <a
                      href={s.itemWebUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                </div>
              ))}
            </div>
          )}

          {result.skipped && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
                Low confidence — the search likely matched more than one
                product.
              </span>
              <button
                type="button"
                onClick={() => run(true)}
                disabled={pending}
                className="text-[11px] font-medium underline hover:no-underline disabled:opacity-50"
              >
                Save anyway
              </button>
            </div>
          )}
        </div>
      )}

      <div className="text-[11px]">
        {editingQuery ? (
          <div className="flex flex-col gap-1.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Zekrom ex 210/193 PSA 10 -RGS -CGC -BGS"
              className="w-full h-8 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
            />
            <div className="text-[10px] text-zinc-500">
              Used verbatim — include your own <code>-negative</code> keywords.
              Leave blank to fall back to the item name.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveQuery}
                disabled={pending}
                className="text-[11px] font-medium underline hover:no-underline"
              >
                Save query
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingQuery(false);
                  setQuery(initialQuery ?? "");
                }}
                className="text-[11px] text-zinc-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingQuery(true)}
            className="text-zinc-500 hover:underline"
          >
            {initialQuery
              ? `Custom query: "${initialQuery.slice(0, 40)}${initialQuery.length > 40 ? "…" : ""}"`
              : "+ Set a custom eBay search query"}
          </button>
        )}
      </div>
    </div>
  );
}
