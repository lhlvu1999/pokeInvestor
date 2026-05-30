"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
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

/**
 * "May 30" — drops the year because for the YouTube sources list nothing is
 * more than a year old in practice and the wrap-to-two-lines was the worst
 * UX offender in the old table.
 */
function shortDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function truncatedId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function SourceCard({ source: s }: { source: YoutubeSource }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggle() {
    setErr(null);
    startTransition(async () => {
      const res = await setYoutubeSourceActive(s.id, !s.active);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  function remove() {
    if (!confirm(`Remove this ${s.kind}? Historical videos and insights stay.`)) {
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await removeYoutubeSource(s.id);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(s.externalId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard write can fail on insecure origins — ignore silently
    }
  }

  return (
    <Card className={`p-0 ${s.active ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-4 p-4 sm:p-5">
        {/* Kind chip — sized so the eye lands here first */}
        <span
          className={`shrink-0 inline-flex items-center text-[10px] uppercase tracking-wider rounded px-2 py-1 font-medium mt-0.5 ${
            s.kind === "channel"
              ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          }`}
        >
          {s.kind}
        </span>

        {/* Center: identity + metadata */}
        <div className="min-w-0 flex-1">
          <a
            href={externalUrl(s)}
            target="_blank"
            rel="noreferrer"
            className="font-medium hover:underline truncate block"
          >
            {s.title ?? <span className="text-zinc-400">unknown</span>}
          </a>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 min-w-0">
            {s.handle && <span className="truncate">{s.handle}</span>}
            {s.handle && <span className="text-zinc-400">·</span>}
            <button
              onClick={copyId}
              title={`Copy ${s.externalId}`}
              className="font-mono hover:text-zinc-900 dark:hover:text-zinc-100 truncate"
            >
              {truncatedId(s.externalId)}
              {copied && <span className="ml-1 text-emerald-600">✓</span>}
            </button>
          </div>

          {/* Metadata pills row */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
            <Pill label="Added" value={shortDate(s.addedAt)} />
            <Pill
              label="Last discover"
              value={shortDate(s.lastDiscoveredAt)}
            />
            <BackfillPill source={s} />
            <StatusPill active={s.active} />
          </div>
        </div>

        {/* Right: actions */}
        <div className="shrink-0 flex flex-col sm:flex-row gap-1.5 sm:gap-2">
          <Button
            variant="secondary"
            onClick={() => setEditing(!editing)}
            className="h-8 px-3 text-xs"
            aria-expanded={editing}
          >
            {editing ? "Close" : "Edit"}
          </Button>
          <Button
            variant="secondary"
            onClick={toggle}
            disabled={pending}
            className="h-8 px-3 text-xs"
          >
            {s.active ? "Pause" : "Resume"}
          </Button>
          <Button
            variant="danger"
            onClick={remove}
            disabled={pending}
            className="h-8 px-3 text-xs"
          >
            Remove
          </Button>
        </div>
      </div>

      {err && (
        <div className="px-5 py-2 text-xs text-rose-600 dark:text-rose-400 border-t border-rose-200/60 dark:border-rose-900/60">
          {err}
        </div>
      )}

      {editing && (
        <div className="border-t border-zinc-200/60 dark:border-zinc-800/60 p-4 sm:p-5 bg-zinc-50/50 dark:bg-zinc-900/30">
          <EditPanel source={s} onDone={() => setEditing(false)} />
        </div>
      )}
    </Card>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-zinc-500">
      <span className="text-zinc-400 uppercase tracking-wider text-[10px]">
        {label}
      </span>
      <span className="text-zinc-700 dark:text-zinc-300">{value}</span>
    </span>
  );
}

function StatusPill({ active }: { active: boolean }) {
  if (active) return null;
  return (
    <span className="inline-flex items-center text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      paused
    </span>
  );
}

function BackfillPill({ source: s }: { source: YoutubeSource }) {
  const detail =
    s.backfillMode === "days"
      ? `${s.backfillDays}d (≤${s.backfillMaxVideos})`
      : `${s.backfillMaxVideos}v`;
  if (s.backfilledAt) {
    return (
      <span
        className="inline-flex items-baseline gap-1 text-zinc-500"
        title={`Backfilled ${shortDate(s.backfilledAt)} · mode=${s.backfillMode}`}
      >
        <span className="text-zinc-400 uppercase tracking-wider text-[10px]">
          Backfill
        </span>
        <span className="text-zinc-700 dark:text-zinc-300">{detail}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      title={`mode=${s.backfillMode}`}
    >
      <span>pending</span>
      <span className="text-amber-600 dark:text-amber-400/80 normal-case tracking-normal">
        {detail}
      </span>
    </span>
  );
}

function EditPanel({
  source: s,
  onDone,
}: {
  source: YoutubeSource;
  onDone: () => void;
}) {
  const router = useRouter();
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
          ? "Saved. Backfill re-queued for the next pipeline pass."
          : "Saved.",
      );
      router.refresh();
      // Brief delay so user sees the success message before the panel folds.
      setTimeout(onDone, 800);
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
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        {msg && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</span>
        )}
        {err && <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span>}
      </div>
    </div>
  );
}
