"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, TextInput } from "@/components/ui";
import { addYoutubeSource } from "@/lib/server/youtube";

export function AddSourceForm() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const trimmed = input.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await addYoutubeSource({
        input: trimmed,
        title: title.trim() || undefined,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(
        `Added ${res.data.kind} ${res.data.externalId}${res.data.handle ? ` (${res.data.handle})` : ""}.`,
      );
      setInput("");
      setTitle("");
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
      <Field
        label="Title (optional)"
        htmlFor="source-title"
        hint="Display label. Auto-refreshed by the discovery job on the next run."
      >
        <TextInput
          id="source-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Poke Rev"
          autoComplete="off"
        />
      </Field>
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
