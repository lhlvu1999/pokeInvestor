"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { setCostMethod } from "@/lib/server/settings";
import type { CostMethod } from "@/lib/calc/holdings";

const OPTIONS: { value: CostMethod; title: string; body: string }[] = [
  {
    value: "fifo",
    title: "FIFO",
    body: "Oldest units are sold first, and a sell that names its lot uses that lot. Realized profit reflects the actual units that left.",
  },
  {
    value: "average",
    title: "Average",
    body: "Every unit you hold costs the running average, whichever purchase it came from. Smoother realized profit, and what many tax rules expect.",
  },
];

export function CostMethodForm({ current }: { current: CostMethod }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<CostMethod>(current);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function onSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await setCostMethod(picked);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="Cost method"
        className="grid gap-2 sm:grid-cols-2"
      >
        {OPTIONS.map((o) => {
          const active = picked === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setPicked(o.value);
                setSavedAt(null);
              }}
              className={`text-left rounded-lg border p-3 transition-colors ${
                active
                  ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-800/60"
                  : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
              }`}
            >
              <div className="text-sm font-medium">{o.title}</div>
              <div className="mt-1 text-xs text-zinc-500">{o.body}</div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500">
        This changes how profit is <em>split</em> between realized and
        unrealized, not how much you made in total. It applies everywhere:
        dashboard, items, cashflow and analytics.
      </p>
      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}
      {savedAt && !error && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400">
          Saved.
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || picked === current}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
