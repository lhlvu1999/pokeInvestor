"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  syncSchema,
  type SyncSchemaResult,
} from "@/lib/server/admin";

export function SyncSchemaSection() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncSchemaResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setErr(null);
    setResult(null);
    startTransition(async () => {
      const res = await syncSchema();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setResult(res.data);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Runs every schema change defined in code as an idempotent SQL
        statement (uses <code>IF NOT EXISTS</code> / exception guards). Safe
        to re-run. Use this when the app errors with{" "}
        <code>column &quot;…&quot; does not exist</code> after pulling new code,
        instead of running <code>db:reset</code>.
      </p>
      <div>
        <Button onClick={run} disabled={pending}>
          {pending ? "Syncing..." : "Sync schema to current code"}
        </Button>
      </div>
      {err && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{err}</div>
      )}
      {result && (
        <div className="text-sm">
          <div
            className={
              result.failedCount === 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-700 dark:text-amber-400"
            }
          >
            Ran {result.ranCount} statement(s)
            {result.failedCount > 0
              ? `, ${result.failedCount} failed.`
              : ", all succeeded."}
          </div>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-zinc-500 hover:underline">
              Show statements
            </summary>
            <ul className="mt-2 space-y-1 max-h-80 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
              {result.steps.map((s, i) => (
                <li
                  key={i}
                  className={`px-3 py-1.5 font-mono text-[11px] ${
                    s.ran
                      ? "text-zinc-600 dark:text-zinc-300"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  <div className="whitespace-pre-wrap break-all">{s.sql}</div>
                  {s.error && (
                    <div className="mt-0.5 text-[10px] opacity-80">
                      {s.error}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
