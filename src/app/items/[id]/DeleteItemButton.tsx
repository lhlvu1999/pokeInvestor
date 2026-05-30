"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteItem } from "@/lib/server/items";

export function DeleteItemButton({
  id,
  name,
  txCount,
}: {
  id: string;
  name: string;
  txCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    const msg =
      txCount > 0
        ? `Delete "${name}" and its ${txCount} transaction(s) and price history? This cannot be undone.`
        : `Delete "${name}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    startTransition(async () => {
      const res = await deleteItem(id);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      router.push("/items");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-sm font-medium border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
    >
      {pending ? "Deleting..." : "Delete item"}
    </button>
  );
}
