"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTransaction } from "@/lib/server/transactions";

export function DeleteTransactionButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("Delete this transaction? Holdings will be recalculated.")) {
      return;
    }
    startTransition(async () => {
      const res = await deleteTransaction(id);
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
      className="text-xs text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50"
    >
      {pending ? "..." : "Delete"}
    </button>
  );
}
