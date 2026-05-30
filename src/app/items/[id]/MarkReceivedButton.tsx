"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markTransactionReceived } from "@/lib/server/transactions";

export function MarkReceivedButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await markTransactionReceived(id);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="text-xs rounded-full border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 px-2 py-0.5 disabled:opacity-50"
    >
      {pending ? "..." : "Mark received"}
    </button>
  );
}
