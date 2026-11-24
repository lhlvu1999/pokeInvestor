"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setExitReasons } from "@/lib/server/exit_reasons";

export type FreeSale = {
  txId: string;
  itemName: string;
  date: string;
  quantity: number;
};

const REASONS = [
  { value: "gifted", label: "Gifted" },
  { value: "lost", label: "Lost / damaged" },
  { value: "opened", label: "Opened" },
] as const;

/** Sales logged for nothing: pick some, say why they left, in one go. */
export function FreeSales({ sales }: { sales: FreeSale[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<string>("lost");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const all = picked.size === sales.length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function apply() {
    setError(null);
    setDone(null);
    const label = REASONS.find((r) => r.value === reason)?.label.toLowerCase();
    if (
      !confirm(
        `Mark ${picked.size} ${picked.size === 1 ? "entry" : "entries"} as ${label}? Your profit total won't change; they stop counting as sales.`,
      )
    ) {
      return;
    }
    start(async () => {
      const res = await setExitReasons([...picked], reason);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(
        `${res.data.changed} ${res.data.changed === 1 ? "entry" : "entries"} updated.`,
      );
      setPicked(new Set());
      router.refresh();
    });
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={all}
            onChange={() =>
              setPicked(all ? new Set() : new Set(sales.map((s) => s.txId)))
            }
          />
          Select all
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Why they left"
          disabled={pending}
          className="h-8 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-xs"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || picked.size === 0}
          onClick={apply}
          className="h-8 rounded-md px-3 text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? "Saving…" : `Mark ${picked.size || ""} selected`.replace("  ", " ")}
        </button>
        {done && <span className="text-emerald-600 dark:text-emerald-400">{done}</span>}
        {error && <span className="text-rose-600 dark:text-rose-400">{error}</span>}
      </div>
      <ul className="mt-2 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
        {sales.map((s) => (
          <li key={s.txId} className="py-2 flex items-center gap-3">
            <input
              type="checkbox"
              checked={picked.has(s.txId)}
              onChange={() => toggle(s.txId)}
              aria-label={`Select ${s.itemName}, ${s.date}`}
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{s.itemName}</span>{" "}
              <span className="text-xs text-zinc-500">
                {`${s.date}${s.quantity > 1 ? ` · ${s.quantity} units` : ""}`}
              </span>
            </span>
            <Link
              href={`/transactions/${s.txId}/edit`}
              className="shrink-0 text-xs text-sky-700 dark:text-sky-400 hover:underline"
            >
              Edit
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
