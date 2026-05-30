"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  removeYoutubeSource,
  setYoutubeSourceActive,
} from "@/lib/server/youtube";
import type { YoutubeSource } from "@/db/schema";

function externalUrl(s: YoutubeSource): string {
  return s.kind === "channel"
    ? `https://www.youtube.com/channel/${s.externalId}`
    : `https://www.youtube.com/watch?v=${s.externalId}`;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SourcesTable({ sources }: { sources: YoutubeSource[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function toggle(s: YoutubeSource) {
    setErr(null);
    setPendingId(s.id);
    startTransition(async () => {
      const res = await setYoutubeSourceActive(s.id, !s.active);
      setPendingId(null);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  function remove(s: YoutubeSource) {
    if (!confirm(`Remove this ${s.kind}? Historical videos and insights stay.`)) {
      return;
    }
    setErr(null);
    setPendingId(s.id);
    startTransition(async () => {
      const res = await removeYoutubeSource(s.id);
      setPendingId(null);
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
            <th className="text-left px-4 py-2.5 font-medium">Kind</th>
            <th className="text-left px-4 py-2.5 font-medium">Title</th>
            <th className="text-left px-4 py-2.5 font-medium">External ID</th>
            <th className="text-left px-4 py-2.5 font-medium">Added</th>
            <th className="text-left px-4 py-2.5 font-medium">Last discover</th>
            <th className="text-right px-4 py-2.5 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr
              key={s.id}
              className={`border-b border-zinc-100 dark:border-zinc-900 last:border-0 ${
                s.active ? "" : "opacity-60"
              }`}
            >
              <td className="px-4 py-2.5">
                <span
                  className={`inline-flex items-center text-[11px] uppercase tracking-wider rounded px-1.5 py-0.5 ${
                    s.kind === "channel"
                      ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  }`}
                >
                  {s.kind}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <div className="font-medium">{s.title ?? <span className="text-zinc-400">unknown</span>}</div>
                {s.handle && (
                  <div className="text-xs text-zinc-500">{s.handle}</div>
                )}
              </td>
              <td className="px-4 py-2.5">
                <a
                  href={externalUrl(s)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-zinc-600 dark:text-zinc-400 hover:underline"
                >
                  {s.externalId}
                </a>
              </td>
              <td className="px-4 py-2.5 text-xs text-zinc-500">
                {formatDate(s.addedAt)}
              </td>
              <td className="px-4 py-2.5 text-xs text-zinc-500">
                {formatDate(s.lastDiscoveredAt)}
              </td>
              <td className="px-4 py-2.5 text-right">
                <div className="inline-flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => toggle(s)}
                    disabled={pendingId === s.id}
                    className="h-8 px-3 text-xs"
                  >
                    {s.active ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => remove(s)}
                    disabled={pendingId === s.id}
                    className="h-8 px-3 text-xs"
                  >
                    Remove
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
