"use client";

/**
 * Bulk eBay price refresh.
 *
 * The client drives the loop rather than one long server action: a full
 * portfolio is ~160 eBay calls at 1-2s each, which would blow past any
 * sane request budget and give the user a spinner with no feedback.
 * Instead we send small chunks, so progress is live and the run is
 * stoppable mid-flight.
 *
 * High/medium-confidence estimates are saved; low-confidence ones are
 * reported but not written (eBay full-text search always returns
 * something, so a bad name match produces a confident-looking wrong
 * price). Skipped items are listed so they can be fixed individually
 * with a per-item query override.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  refreshPricesForItems,
  type BulkPriceOutcome,
  type PriceRefreshTarget,
} from "@/lib/server/prices";
import { formatAmount } from "@/lib/currency";
import { useToast } from "@/components/Toast";

/** Items per server round-trip. Each runs its eBay calls concurrently. */
const CHUNK_SIZE = 8;

type Status = "idle" | "running" | "stopping" | "done";

export function BulkPriceRefresh({
  targets,
  onCooldown = [],
}: {
  targets: PriceRefreshTarget[];
  /** Held items skipped because they were priced within the last hour.
   * Only sent to the server when the user ticks the override. */
  onCooldown?: PriceRefreshTarget[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<BulkPriceOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ignoreCooldown, setIgnoreCooldown] = useState(false);
  const stopRef = useRef(false);

  // With the override on we also re-price the cooling-down items, so the
  // run covers everything held.
  const queue = ignoreCooldown ? [...targets, ...onCooldown] : targets;
  const total = queue.length;

  async function run() {
    setStatus("running");
    setDone(0);
    setResults([]);
    setError(null);
    stopRef.current = false;

    const collected: BulkPriceOutcome[] = [];
    for (let i = 0; i < queue.length; i += CHUNK_SIZE) {
      if (stopRef.current) break;
      const chunk = queue.slice(i, i + CHUNK_SIZE).map((t) => t.id);
      const res = await refreshPricesForItems(chunk, { ignoreCooldown });
      if (!res.ok) {
        setError(res.error);
        break;
      }
      collected.push(...res.data);
      setResults([...collected]);
      setDone(Math.min(i + CHUNK_SIZE, queue.length));
    }

    setStatus("done");
    const saved = collected.filter((r) => r.status === "saved").length;
    const skipped = collected.filter((r) => r.status === "skipped").length;
    toast.show({
      kind: saved > 0 ? "success" : "info",
      message: `Priced ${saved} item${saved === 1 ? "" : "s"}${
        skipped > 0 ? ` · ${skipped} skipped (low confidence)` : ""
      }`,
    });
    router.refresh();
  }

  const saved = results.filter((r) => r.status === "saved");
  const skipped = results.filter((r) => r.status === "skipped");
  const noData = results.filter((r) => r.status === "no_data");
  const errored = results.filter((r) => r.status === "error");
  const cooled = results.filter((r) => r.status === "cooldown");
  // Cooldown isn't a problem to fix — it's the guard working — so it is
  // reported in the counters but kept out of "needs attention".
  const problems = [...skipped, ...noData, ...errored];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        Update all prices
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-start justify-center p-6 overflow-y-auto"
      onClick={() => status !== "running" && setOpen(false)}
    >
      <div
        className="w-full max-w-3xl bg-white dark:bg-zinc-950 rounded-lg shadow-xl p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold">Update all prices from eBay</h2>
          {status !== "running" && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-zinc-500 hover:underline"
            >
              Close
            </button>
          )}
        </div>

        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          {total} item{total === 1 ? "" : "s"} · one eBay call each ({total} of
          your 5,000 daily quota). Uses <strong>asking</strong> prices;
          low-confidence matches are reported but not saved.
        </div>

        {onCooldown.length > 0 && (
          <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-2.5 flex flex-col gap-1.5">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {/* Built as one string — interleaving conditionals with JSX
                  text nodes silently dropped a space ("areon cooldown"). */}
              <strong>{onCooldown.length}</strong>
              {onCooldown.length === 1
                ? " held item was priced in the last hour and is on cooldown."
                : " held items were priced in the last hour and are on cooldown."}{" "}
              Asking prices don&apos;t move meaningfully that fast, so
              re-fetching just spends quota.
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ignoreCooldown}
                onChange={(e) => setIgnoreCooldown(e.target.checked)}
                disabled={status === "running"}
                className="accent-zinc-900 dark:accent-zinc-100"
              />
              Re-price them anyway (+{onCooldown.length} calls)
            </label>
          </div>
        )}

        {status !== "idle" && (
          <div className="flex flex-col gap-1.5">
            <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-zinc-900 dark:bg-zinc-100 transition-[width] duration-300"
                style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
              />
            </div>
            <div className="text-xs text-zinc-500 tabular-nums">
              {done} / {total}
              {saved.length > 0 && ` · ${saved.length} saved`}
              {skipped.length > 0 && ` · ${skipped.length} skipped`}
              {noData.length > 0 && ` · ${noData.length} no data`}
              {cooled.length > 0 && ` · ${cooled.length} on cooldown`}
              {errored.length > 0 && ` · ${errored.length} errors`}
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-2 text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {problems.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">
              Needs attention ({problems.length}) — open the item and set a
              custom eBay query
            </div>
            <div className="max-h-52 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded divide-y divide-zinc-200 dark:divide-zinc-800">
              {problems.map((r) => (
                <div
                  key={r.itemId}
                  className="px-2.5 py-1.5 text-xs flex items-baseline gap-2"
                >
                  <span
                    className={`text-[10px] uppercase tracking-wider shrink-0 ${
                      r.status === "skipped"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-zinc-500"
                    }`}
                  >
                    {r.status === "skipped"
                      ? "low conf"
                      : r.status === "no_data"
                        ? "no data"
                        : "error"}
                  </span>
                  <Link
                    href={`/items/${r.itemId}`}
                    className="font-medium hover:underline truncate"
                  >
                    {r.itemName}
                  </Link>
                  {r.topSampleTitle && (
                    <span className="text-zinc-500 truncate hidden sm:inline">
                      matched: {r.topSampleTitle}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {saved.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-500 hover:underline">
              {saved.length} priced successfully
            </summary>
            <div className="mt-1.5 max-h-52 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded divide-y divide-zinc-200 dark:divide-zinc-800">
              {saved.map((r) => (
                <div
                  key={r.itemId}
                  className="px-2.5 py-1.5 flex items-baseline justify-between gap-2"
                >
                  <Link
                    href={`/items/${r.itemId}`}
                    className="truncate hover:underline"
                  >
                    {r.itemName}
                  </Link>
                  <span className="tabular-nums shrink-0">
                    {r.priceCents != null && r.currency
                      ? formatAmount(r.priceCents, r.currency)
                      : "-"}
                    <span className="text-[10px] text-zinc-500 ml-1.5">
                      {r.confidence}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="flex items-center justify-end gap-2">
          {status === "running" ? (
            <button
              type="button"
              onClick={() => {
                stopRef.current = true;
                setStatus("stopping");
              }}
              className="inline-flex items-center justify-center rounded-md px-4 h-10 text-sm font-medium border border-zinc-300 dark:border-zinc-700"
            >
              Stop after current batch
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              disabled={total === 0}
              className="inline-flex items-center justify-center rounded-md px-4 h-10 text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
            >
              {total === 0
                ? "Nothing to update"
                : status === "done"
                  ? "Run again"
                  : `Update ${total} prices`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
