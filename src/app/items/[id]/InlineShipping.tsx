"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTransactionShipping } from "@/lib/server/transactions";
import {
  formatAmount,
  minorToDecimalString,
} from "@/lib/currency";

export function InlineShipping({
  id,
  currency,
  shippingCents,
}: {
  id: string;
  currency: string;
  shippingCents: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(
    shippingCents != null ? minorToDecimalString(shippingCents, currency) : "",
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setTransactionShipping(id, draft);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return shippingCents != null && shippingCents > 0 ? (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:underline"
        title="Click to edit shipping breakdown"
      >
        incl. {formatAmount(shippingCents, currency)} shipping
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline-offset-2 hover:underline"
        title="Split shipping out of this transaction's total"
      >
        + split shipping
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          placeholder="0"
          disabled={pending}
          className="h-6 px-2 text-[10px] rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 w-24"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? "..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          className="text-[10px] text-zinc-500 hover:underline"
        >
          Cancel
        </button>
      </div>
      {error && (
        <span className="text-[10px] text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
    </div>
  );
}
