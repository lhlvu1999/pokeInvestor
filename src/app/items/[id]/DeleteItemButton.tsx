"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteItem, restoreItem } from "@/lib/server/items";
import { useToast } from "@/components/Toast";

export function DeleteItemButton({
  id,
  name,
  txCount,
  variant = "button",
}: {
  id: string;
  name: string;
  txCount: number;
  /** "menu" renders as a full-width row for use inside a MoreMenu. */
  variant?: "button" | "menu";
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    const msg =
      txCount > 0
        ? `Delete "${name}" and its ${txCount} transaction(s) and price history? Undo will only restore the item itself — its transactions are gone permanently.`
        : `Delete "${name}"?`;
    if (!confirm(msg)) return;
    startTransition(async () => {
      const res = await deleteItem(id);
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      const deleted = res.data;
      router.push("/items");
      router.refresh();
      toast.show({
        kind: "info",
        message: `Deleted "${deleted.name}"`,
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await restoreItem(deleted);
            if (!undo.ok) {
              toast.show({ kind: "error", message: undo.error });
              return;
            }
            router.push(`/items/${deleted.id}`);
            router.refresh();
            toast.show({
              kind: "success",
              message: `Restored "${deleted.name}"`,
            });
          },
        },
      });
    });
  }

  return (
    <button
      type="button"
      role={variant === "menu" ? "menuitem" : undefined}
      onClick={handleClick}
      disabled={pending}
      className={
        variant === "menu"
          ? "w-full text-left rounded-md px-3 py-2 text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
          : "inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-sm font-medium border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
      }
    >
      {pending ? "Deleting..." : "Delete item"}
    </button>
  );
}
