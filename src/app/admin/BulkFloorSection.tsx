"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Select } from "@/components/ui";
import { Money } from "@/components/Money";
import {
  applyBulkFloors,
  previewBulkFloors,
  type BulkFloorPreview,
} from "@/lib/server/price_floor_bulk";

const LEVELS = [
  { percent: 0, label: "At my cost" },
  { percent: 10, label: "10% below my cost" },
  { percent: 20, label: "20% below my cost" },
] as const;

export function BulkFloorSection() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [percent, setPercent] = useState<number>(20);
  const [preview, setPreview] = useState<BulkFloorPreview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setPreview(null);
    setMsg(null);
    setErr(null);
  }

  function showPreview() {
    reset();
    startTransition(async () => {
      const res = await previewBulkFloors(percent);
      if (!res.ok) setErr(res.error);
      else setPreview(res.data);
    });
  }

  function apply() {
    if (!preview || preview.count === 0) return;
    const now =
      preview.alertsNow > 0
        ? ` ${preview.alertsNow} of them are already at or below it and would be flagged on the next alert run.`
        : "";
    if (
      !confirm(
        `Set a price floor on ${preview.count} item(s)? Floors you already set are left alone.${now}`,
      )
    ) {
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await applyBulkFloors(percent);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setPreview(null);
      setMsg(`Set a price floor on ${res.data.set} item(s).`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Give every item you hold that has no floor yet one based on what you paid per unit. Floors
        you set yourself are never changed. A floor is a heads-up when the market price falls to
        it, not a recommendation to do anything.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={percent}
          onChange={(e) => {
            setPercent(Number(e.target.value));
            reset();
          }}
          aria-label="Floor level"
        >
          {LEVELS.map((l) => (
            <option key={l.percent} value={l.percent}>
              {l.label}
            </option>
          ))}
        </Select>
        <Button variant="secondary" onClick={showPreview} disabled={pending}>
          {pending && !preview ? "Checking..." : "Preview"}
        </Button>
      </div>

      {preview && (
        <div className="flex flex-col gap-2 text-sm">
          {preview.count === 0 ? (
            <div className="text-zinc-500">
              Nothing to set
              {preview.alreadySet > 0 ? ` (${preview.alreadySet} already have a floor)` : ""}.
            </div>
          ) : (
            <>
              <div>
                <strong>{preview.count}</strong> item(s) would get a floor
                {preview.alreadySet > 0 && `, ${preview.alreadySet} already have one`}
                {preview.noCost > 0 && `, ${preview.noCost} skipped (no cost to go on)`}.
              </div>
              {preview.alertsNow > 0 && (
                <div className="text-amber-700 dark:text-amber-400">
                  {preview.alertsNow} of these are already at or below that level, so the next
                  alert run would flag them.
                </div>
              )}
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-md text-xs">
                {preview.sample.map((s) => (
                  <li key={s.id} className="px-3 py-1.5 flex items-center justify-between gap-3">
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 tabular-nums">
                      <Money amount={s.floorCents} currency={s.currency} />
                      {s.alertsNow && <span className="ml-2 text-amber-700 dark:text-amber-400">at floor now</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {preview.count > preview.sample.length && (
                <div className="text-xs text-zinc-500">
                  and {preview.count - preview.sample.length} more
                </div>
              )}
              <div>
                <Button onClick={apply} disabled={pending}>
                  {pending ? "Applying..." : `Set ${preview.count} floor(s)`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {msg && <div className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>}
      {err && <div className="text-sm text-rose-600 dark:text-rose-400">{err}</div>}
    </div>
  );
}
