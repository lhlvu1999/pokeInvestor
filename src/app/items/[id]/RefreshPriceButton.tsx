"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshPriceFromPriceCharting } from "@/lib/server/prices";
import { formatAmount } from "@/lib/currency";

export function RefreshPriceButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      const res = await refreshPriceFromPriceCharting(itemId);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(
        `Updated to ${formatAmount(res.data.priceCents, res.data.currency)} (PriceCharting → ${res.data.currency})`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-md px-3 h-9 text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Fetching..." : "Refresh from PriceCharting"}
      </button>
      {msg && (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">
          {msg}
        </span>
      )}
      {err && (
        <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span>
      )}
    </div>
  );
}
