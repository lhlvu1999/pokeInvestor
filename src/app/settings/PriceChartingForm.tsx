"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, TextInput } from "@/components/ui";
import { setPriceChartingToken } from "@/lib/server/settings";

export function PriceChartingForm({ hasToken }: { hasToken: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [value, setValue] = useState("");

  function onSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await setPriceChartingToken(value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
      setValue("");
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-3">
      <Field
        label="API token"
        htmlFor="pc-token"
        hint={
          hasToken
            ? "A token is currently stored. Type a new one to replace, or leave empty and submit to clear."
            : "Not yet set."
        }
      >
        <TextInput
          id="pc-token"
          name="token"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={hasToken ? "•••••••• (set)" : ""}
          autoComplete="off"
        />
      </Field>
      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}
      {savedAt && !error && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400">
          Saved.
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save token"}
        </Button>
      </div>
    </form>
  );
}
