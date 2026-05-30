"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { setActivePromptVersion } from "@/lib/server/prompts";
import type { Prompt } from "@/db/schema";

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PromptHistory({ versions }: { versions: Prompt[] }) {
  const router = useRouter();
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function activate(p: Prompt) {
    setErr(null);
    setPendingVersion(p.version);
    startTransition(async () => {
      const res = await setActivePromptVersion(p.name, p.version);
      setPendingVersion(null);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="overflow-x-auto">
      {err && (
        <div className="px-5 py-2 text-xs text-rose-600 dark:text-rose-400 border-b border-rose-200/60 dark:border-rose-900/60">
          {err}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium">Version</th>
            <th className="text-left px-4 py-2.5 font-medium">Created</th>
            <th className="text-left px-4 py-2.5 font-medium">By</th>
            <th className="text-right px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((p) => (
            <tr
              key={p.id}
              className="border-b border-zinc-100 dark:border-zinc-900 last:border-0"
            >
              <td className="px-4 py-2.5 font-mono">v{p.version}</td>
              <td className="px-4 py-2.5 text-xs text-zinc-500">
                {formatTimestamp(p.createdAt)}
              </td>
              <td className="px-4 py-2.5 text-xs text-zinc-500">
                {p.createdBy ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-right">
                {p.isActive ? (
                  <span className="inline-flex items-center text-[11px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    active
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => activate(p)}
                    disabled={pendingVersion === p.version}
                    className="h-8 px-3 text-xs"
                  >
                    {pendingVersion === p.version ? "Switching…" : "Set active"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
