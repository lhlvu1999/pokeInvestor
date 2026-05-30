"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@/components/ui";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { setDisplayCurrency } from "@/lib/server/settings";

export function SettingsForm({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [picked, setPicked] = useState(current);

  function onSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await setDisplayCurrency(picked);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <Field
        label="Display currency"
        htmlFor="display-currency"
        hint="All dashboard totals and item lists will be converted to this currency using today's spot FX rate."
      >
        <CurrencyPicker
          id="display-currency"
          name="displayCurrency"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
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
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
