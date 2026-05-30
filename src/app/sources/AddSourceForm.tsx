"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, TextInput } from "@/components/ui";
import { addYoutubeSource } from "@/lib/server/youtube";
import type { YoutubeBackfillMode } from "@/db/schema";

const DEFAULT_COUNT = "100";
const DEFAULT_DAYS = "180";

export function AddSourceForm({ onAdded }: { onAdded?: () => void } = {}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<YoutubeBackfillMode>("count");
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const trimmed = input.trim();
    if (!trimmed) return;

    // Validate numeric inputs upfront so a bad value never hits the server.
    let backfillMaxVideos: number | undefined;
    let backfillDays: number | undefined;
    if (count.trim().length > 0) {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 0 || n > 1000) {
        setErr("Max videos must be a whole number between 0 and 1000.");
        return;
      }
      backfillMaxVideos = n;
    }
    if (mode === "days" && days.trim().length > 0) {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        setErr("Days must be a whole number between 1 and 3650.");
        return;
      }
      backfillDays = n;
    }

    startTransition(async () => {
      const res = await addYoutubeSource({
        input: trimmed,
        title: title.trim() || undefined,
        backfillMode: mode,
        backfillMaxVideos,
        backfillDays,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const desc =
        res.data.backfillMode === "days"
          ? `last ${res.data.backfillDays} day(s), up to ${res.data.backfillMaxVideos} videos`
          : `${res.data.backfillMaxVideos} videos`;
      setMsg(
        `Added ${res.data.kind} ${res.data.externalId}${res.data.handle ? ` (${res.data.handle})` : ""}. Backfill (${desc}) will run on the next pipeline pass.`,
      );
      setInput("");
      setTitle("");
      setMode("count");
      setCount(DEFAULT_COUNT);
      setDays(DEFAULT_DAYS);
      router.refresh();
      onAdded?.();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label="Channel / video"
        htmlFor="source-input"
        hint="Paste a YouTube channel URL (`/channel/UC…` or `@handle`), a video URL, or a bare ID."
      >
        <TextInput
          id="source-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://www.youtube.com/@PokeRev"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field
        label="Title (optional)"
        htmlFor="source-title"
        hint="Display label. Refreshed by the discovery job on each run."
      >
        <TextInput
          id="source-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Poke Rev"
          autoComplete="off"
        />
      </Field>

      <BackfillModeFields
        mode={mode}
        setMode={setMode}
        count={count}
        setCount={setCount}
        days={days}
        setDays={setDays}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || input.trim().length === 0}>
          {pending ? "Adding…" : "Add source"}
        </Button>
        {msg && <span className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</span>}
        {err && <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span>}
      </div>
    </form>
  );
}

/**
 * Mode toggle + the active mode's numeric input. Exported so the edit
 * form on each row can reuse the exact same control.
 */
export function BackfillModeFields({
  mode,
  setMode,
  count,
  setCount,
  days,
  setDays,
}: {
  mode: YoutubeBackfillMode;
  setMode: (m: YoutubeBackfillMode) => void;
  count: string;
  setCount: (s: string) => void;
  days: string;
  setDays: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Backfill depth
      </span>
      <div className="flex items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="backfill-mode"
            checked={mode === "count"}
            onChange={() => setMode("count")}
            className="accent-zinc-900 dark:accent-zinc-100"
          />
          <span>By count</span>
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="backfill-mode"
            checked={mode === "days"}
            onChange={() => setMode("days")}
            className="accent-zinc-900 dark:accent-zinc-100"
          />
          <span>By time range</span>
        </label>
      </div>

      {mode === "count" ? (
        <Field
          label="Max videos"
          htmlFor="bf-count"
          hint="The N newest videos. Fast (one HTTP), no dates for backfilled rows."
        >
          <TextInput
            id="bf-count"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            inputMode="numeric"
            placeholder={DEFAULT_COUNT}
          />
        </Field>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Days back"
            htmlFor="bf-days"
            hint="Fetch videos uploaded in the last N days."
          >
            <TextInput
              id="bf-days"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              placeholder={DEFAULT_DAYS}
            />
          </Field>
          <Field
            label="Safety cap (max videos)"
            htmlFor="bf-count-days"
            hint="Hard limit on per-video extracts even if the time window has more."
          >
            <TextInput
              id="bf-count-days"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              inputMode="numeric"
              placeholder={DEFAULT_COUNT}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
