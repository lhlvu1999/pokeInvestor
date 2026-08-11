"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  markWatchlistHit,
  removeWatchlistItem,
  restoreWatchlistItem,
} from "@/lib/server/watchlist";
import { useToast } from "@/components/Toast";

export function WatchlistRowActions({
  entryId,
  entryName,
  linkedItemId,
}: {
  entryId: string;
  entryName: string;
  linkedItemId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function markBought() {
    startTransition(async () => {
      // Preserve the watchlist entry as history; don't delete it.
      const res = await markWatchlistHit(entryId);
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      toast.show({
        kind: "success",
        message: `Marked "${entryName}" as bought — logging the transaction now`,
      });
      // If we have a linked item, jump straight to the pre-filled buy
      // form. Otherwise the user can create the item first via the
      // ItemPicker's inline-create.
      const url = linkedItemId
        ? `/transactions/new?itemId=${linkedItemId}&type=buy`
        : `/transactions/new?type=buy`;
      router.push(url);
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await removeWatchlistItem(entryId);
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      const removed = res.data;
      router.refresh();
      toast.show({
        kind: "info",
        message: `Removed "${removed.name}"`,
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await restoreWatchlistItem(removed);
            if (!undo.ok) {
              toast.show({ kind: "error", message: undo.error });
              return;
            }
            router.refresh();
            toast.show({ kind: "success", message: `Restored` });
          },
        },
      });
    });
  }

  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      {linkedItemId && (
        <Link
          href={`/items/${linkedItemId}`}
          className="text-xs text-zinc-500 hover:underline"
        >
          View item
        </Link>
      )}
      <button
        type="button"
        onClick={markBought}
        disabled={pending}
        className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-50"
      >
        Bought
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="text-xs text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}
