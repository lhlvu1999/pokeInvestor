"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteTransaction,
  restoreTransaction,
} from "@/lib/server/transactions";
import { useToast } from "@/components/Toast";

export function DeleteTransactionButton({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    // Silent delete + undo toast — no confirm dialog. The undo lifeline
    // covers the "fat finger" case, and confirm() is a nag when you
    // meant it.
    startTransition(async () => {
      const res = await deleteTransaction(id);
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      const tx = res.data;
      router.refresh();
      toast.show({
        kind: "info",
        message: `Deleted ${tx.type} of ${tx.quantity}`,
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await restoreTransaction(tx);
            if (!undo.ok) {
              toast.show({ kind: "error", message: undo.error });
              return;
            }
            router.refresh();
            toast.show({ kind: "success", message: "Transaction restored" });
          },
        },
      });
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
