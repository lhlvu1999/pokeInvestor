"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, TextInput } from "@/components/ui";
import { addYoutubeSource } from "@/lib/server/youtube";

const DEFAULT_BACKFILL = "100";

export function AddSourceForm() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [backfill, setBackfill] = useState(DEFAULT_BACKFILL);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const trimmed = input.trim();
    if (!trimmed) return;

    // Parse backfill count up front so a bad value never makes it to the server.
    let backfillMaxVideos: number | undefined;
    if (backfill.trim().length > 0) {
      const n = Number(backfill);
      if (!Number.isInteger(n) || n < 0 || n > 1000) {
        setErr("Backfill count must be a whole number between 0 and 1000.");
        return;
      }
      backfillMaxVideos = n;
    }

    startTransition(async () => {
      const res = await addYoutubeSource({
        input: trimmed,
        title: title.trim() || undefined,
        backfillMaxVideos,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const cap = res.data.backfillMaxVideos;
      setMsg(
        `Added ${res.data.kind} ${res.data.externalId}${res.data.handle ? ` (${res.data.handle})` : ""}` +
          `. Backfill of up to ${cap} video(s) will run on the next pipeline pass.`,
      );
      setInput("");
      setTitle("");
      setBackfill(DEFAULT_BACKFILL);
      router.refresh();
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <Field
          label="Backfill (videos)"
          htmlFor="source-backfill"
          hint="How many recent videos to fetch on first add (0–1000). Default 100. RSS only sees ~15, so this controls how much history we get."
        >
          <TextInput
            id="source-backfill"
            value={backfill}
            onChange={(e) => setBackfill(e.target.value)}
            inputMode="numeric"
            placeholder={DEFAULT_BACKFILL}
          />
        </Field>
      </div>
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
