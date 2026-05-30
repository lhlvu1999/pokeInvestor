"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  removeYoutubeSource,
  setYoutubeSourceActive,
  updateYoutubeSource,
} from "@/lib/server/youtube";
import type { YoutubeBackfillMode, YoutubeSource } from "@/db/schema";
import { BackfillModeFields } from "./AddSourceForm";

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

const COLSPAN = 7;

export function SourcesTable({ sources }: { sources: YoutubeSource[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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
            <th className="text-left px-4 py-2.5 font-medium">Backfill</th>
            <th className="text-left px-4 py-2.5 font-medium">Last discover</th>
            <th className="text-right px-4 py-2.5 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <FragmentRow
              key={s.id}
              source={s}
              expanded={editingId === s.id}
              onToggleEdit={() =>
                setEditingId(editingId === s.id ? null : s.id)
              }
              onToggle={() => toggle(s)}
              onRemove={() => remove(s)}
              pending={pendingId === s.id}
              onEditSaved={() => {
                setEditingId(null);
                router.refresh();
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  source: s,
  expanded,
  onToggleEdit,
  onToggle,
  onRemove,
  pending,
  onEditSaved,
}: {
  source: YoutubeSource;
  expanded: boolean;
  onToggleEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
  pending: boolean;
  onEditSaved: () => void;
}) {
  return (
    <>
      <tr
        className={`border-b border-zinc-100 dark:border-zinc-900 last:border-0 ${s.active ? "" : "opacity-60"} ${expanded ? "bg-zinc-50/50 dark:bg-zinc-900/30" : ""}`}
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
          <div className="font-medium">
            {s.title ?? <span className="text-zinc-400">unknown</span>}
          </div>
          {s.handle && <div className="text-xs text-zinc-500">{s.handle}</div>}
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
        <td className="px-4 py-2.5 text-xs">
          <BackfillBadge source={s} />
        </td>
        <td className="px-4 py-2.5 text-xs text-zinc-500">
          {formatDate(s.lastDiscoveredAt)}
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="inline-flex gap-2">
            <Button
              variant="secondary"
              onClick={onToggleEdit}
              className="h-8 px-3 text-xs"
              aria-expanded={expanded}
            >
              {expanded ? "Close" : "Edit"}
            </Button>
            <Button
              variant="secondary"
              onClick={onToggle}
              disabled={pending}
              className="h-8 px-3 text-xs"
            >
              {s.active ? "Pause" : "Resume"}
            </Button>
            <Button
              variant="danger"
              onClick={onRemove}
              disabled={pending}
              className="h-8 px-3 text-xs"
            >
              Remove
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-100 dark:border-zinc-900 last:border-0 bg-zinc-50/50 dark:bg-zinc-900/30">
          <td colSpan={COLSPAN} className="px-5 py-4">
            <EditPanel source={s} onSaved={onEditSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

function BackfillBadge({ source: s }: { source: YoutubeSource }) {
  const mode = s.backfillMode === "days"
    ? `${s.backfillDays}d (≤${s.backfillMaxVideos})`
    : `${s.backfillMaxVideos}v`;
  if (s.backfilledAt) {
    return (
      <span className="text-zinc-500" title={`Mode: ${s.backfillMode}`}>
        {formatDate(s.backfilledAt)} ·{" "}
        <span className="text-zinc-400">{mode}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center text-[11px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      title={`Mode: ${s.backfillMode}`}
    >
      pending · {mode}
    </span>
  );
}

function EditPanel({
  source: s,
  onSaved,
}: {
  source: YoutubeSource;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<YoutubeBackfillMode>(s.backfillMode);
  const [count, setCount] = useState(String(s.backfillMaxVideos));
  const [days, setDays] = useState(String(s.backfillDays));
  const [requeue, setRequeue] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setErr(null);
    setMsg(null);

    let backfillMaxVideos: number | undefined;
    let backfillDays: number | undefined;
    if (count.trim().length > 0) {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 0 || n > 1000) {
        setErr("Max videos must be between 0 and 1000.");
        return;
      }
      backfillMaxVideos = n;
    }
    if (mode === "days" && days.trim().length > 0) {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        setErr("Days must be between 1 and 3650.");
        return;
      }
      backfillDays = n;
    }

    startTransition(async () => {
      const res = await updateYoutubeSource({
        id: s.id,
        backfillMode: mode,
        backfillMaxVideos,
        backfillDays,
        requeueBackfill: requeue,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(
        requeue
          ? "Saved. Backfill re-queued — will run on the next pipeline pass."
          : "Saved.",
      );
      onSaved();
    });
  }

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <BackfillModeFields
        mode={mode}
        setMode={setMode}
        count={count}
        setCount={setCount}
        days={days}
        setDays={setDays}
      />
      <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={requeue}
          onChange={(e) => setRequeue(e.target.checked)}
          className="accent-zinc-900 dark:accent-zinc-100"
        />
        <span>
          Re-queue backfill on save{" "}
          <span className="text-xs text-zinc-500">
            (clears the &ldquo;done&rdquo; flag so the next cron processes
            this source again)
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</span>
        )}
        {err && <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span>}
      </div>
    </div>
  );
}
