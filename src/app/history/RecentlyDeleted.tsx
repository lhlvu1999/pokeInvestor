"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Money } from "@/components/Money";
import { useToast } from "@/components/Toast";
import { displayExitReason, EXIT_REASON_LABELS } from "@/lib/calc/exit_reason";
import { DELETED_RETENTION_DAYS } from "@/lib/calc/recently_deleted";
import {
  purgeDeletedTransaction,
  restoreDeletedTransaction,
  type DeletedTransactionRow,
} from "@/lib/server/transactions";

/**
 * Deleted transactions stay restorable for a month. This is the safety net
 * behind the Undo toast: it still works after the toast is gone, a reload,
 * or a closed tab.
 */
export function RecentlyDeleted({ rows }: { rows: DeletedTransactionRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (rows.length === 0) return null;

  function restore(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await restoreDeletedTransaction(id);
      setBusyId(null);
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      router.refresh();
      toast.show({ kind: "success", message: "Transaction restored" });
    });
  }

  function purge(id: string) {
    if (!confirm("Delete this for good? It can't be restored afterwards.")) {
      return;
    }
    setBusyId(id);
    startTransition(async () => {
      await purgeDeletedTransaction(id);
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <details className="group" data-testid="recently-deleted">
      <summary className="cursor-pointer select-none text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
        <span className="text-zinc-400 transition-transform group-open:rotate-90">
          ›
        </span>
        Recently deleted
        <span className="text-xs font-normal text-zinc-500">
          {rows.length} · kept {DELETED_RETENTION_DAYS} days
        </span>
      </summary>
      <Card className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium text-left">Deleted</th>
              <th className="px-4 py-2 font-medium text-left">Item</th>
              <th className="px-4 py-2 font-medium text-left">What</th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Total</th>
              <th className="px-4 py-2 font-medium text-right">Expires</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => {
              const reason = displayExitReason(r.exitReason);
              const what =
                r.type === "buy"
                  ? "Buy"
                  : reason === "sold"
                    ? "Sell"
                    : EXIT_REASON_LABELS[reason];
              const busy = pending && busyId === r.id;
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-zinc-500">
                    {new Date(r.deletedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 font-medium">{r.itemName}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                    {what}
                    <span className="text-zinc-400">
                      {" "}
                      · {new Date(r.occurredAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.quantity}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <Money amount={r.finalValueCents} currency={r.currency} />
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-zinc-500 whitespace-nowrap">
                    {r.daysLeft === 0
                      ? "today"
                      : `in ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}`}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => restore(r.id)}
                      disabled={pending}
                      className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline mr-3 disabled:opacity-50"
                    >
                      {busy ? "..." : "Restore"}
                    </button>
                    <button
                      type="button"
                      onClick={() => purge(r.id)}
                      disabled={pending}
                      className="text-xs text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50"
                    >
                      Delete forever
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </details>
  );
}
