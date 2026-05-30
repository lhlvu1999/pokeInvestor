"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Textarea } from "@/components/ui";
import { savePromptVersion } from "@/lib/server/prompts";
import type { Prompt } from "@/db/schema";

/**
 * Editable surface of a prompt — content only. Model + temperature live
 * on the row but are controlled per environment via the `LLM_MODEL` and
 * `LLM_TEMPERATURE` env vars in the pipeline. Saving inherits the active
 * row's stored model/temperature unchanged.
 */
type Draft = {
  systemText: string;
  userTemplate: string;
  responseSchema: string;
};

function draftFrom(p: Prompt): Draft {
  return {
    systemText: p.systemText,
    userTemplate: p.userTemplate,
    responseSchema: JSON.stringify(p.responseSchema, null, 2),
  };
}

function isDirty(d: Draft, p: Prompt): boolean {
  const original = draftFrom(p);
  return (
    d.systemText !== original.systemText ||
    d.userTemplate !== original.userTemplate ||
    d.responseSchema !== original.responseSchema
  );
}

export function PromptEditor({ prompt }: { prompt: Prompt }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(prompt));
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = isDirty(draft, prompt);

  function save() {
    setErr(null);
    setMsg(null);

    let responseSchema: unknown;
    try {
      responseSchema = JSON.parse(draft.responseSchema);
    } catch (e) {
      setErr(`Response schema is not valid JSON: ${(e as Error).message}`);
      return;
    }

    startTransition(async () => {
      const res = await savePromptVersion({
        name: prompt.name,
        // Model + temperature are inherited from the current row — the
        // pipeline overrides them per environment via env vars.
        model: prompt.model,
        temperature: prompt.temperature,
        systemText: draft.systemText,
        userTemplate: draft.userTemplate,
        responseSchema,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(`Saved as version ${res.data.version} and made active.`);
      router.refresh();
    });
  }

  function reset() {
    setDraft(draftFrom(prompt));
    setErr(null);
    setMsg(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="System prompt"
        htmlFor="prompt-system"
        hint="Instructions, glossary, and rules. Sent as the system message."
      >
        <Textarea
          id="prompt-system"
          value={draft.systemText}
          onChange={(e) => setDraft({ ...draft, systemText: e.target.value })}
          rows={10}
          className="font-mono text-xs"
        />
      </Field>

      <Field
        label="User template"
        htmlFor="prompt-user"
        hint="Sent as the user message. Use {{title}} and {{transcript}} placeholders."
      >
        <Textarea
          id="prompt-user"
          value={draft.userTemplate}
          onChange={(e) => setDraft({ ...draft, userTemplate: e.target.value })}
          rows={6}
          className="font-mono text-xs"
        />
      </Field>

      <Field
        label="Response JSON Schema"
        htmlFor="prompt-schema"
        hint="OpenAI structured outputs schema (strict mode). Must be valid JSON. Local backends (Ollama) use this only as documentation in the system prompt — they don't enforce it."
      >
        <Textarea
          id="prompt-schema"
          value={draft.responseSchema}
          onChange={(e) => setDraft({ ...draft, responseSchema: e.target.value })}
          rows={14}
          className="font-mono text-[11px] leading-snug"
          spellCheck={false}
        />
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save as new version"}
        </Button>
        <Button variant="secondary" onClick={reset} disabled={pending || !dirty}>
          Reset
        </Button>
        {msg && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</span>
        )}
        {err && <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span>}
      </div>
    </div>
  );
}
