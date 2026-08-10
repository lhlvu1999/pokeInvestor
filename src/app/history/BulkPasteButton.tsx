"use client";

/**
 * Paste a batch of transactions as tab/comma-separated rows. Preview
 * shows per-row match status; commit runs createTransactionsBulk. Any
 * item not matched by name (case-insensitive substring) is offered as
 * "will create new".
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTransactionsBulk } from "@/lib/server/transactions";
import { DEFAULT_TRANSACTION_CURRENCY } from "@/lib/currency";
import { useToast } from "@/components/Toast";

export type Existing = { id: string; name: string; currency: string | null };

type Parsed = {
  ok: true;
  date: string;
  type: "buy" | "sell";
  itemName: string;
  matchedId: string | null;
  quantity: number;
  total: string;
  currency: string;
};

type Row = Parsed | { ok: false; raw: string; error: string };

const PLACEHOLDER = `# Paste one transaction per line.
# Columns (tab or comma separated):
#   date, type, item name, quantity, total, currency
# Currency is optional (defaults to ${DEFAULT_TRANSACTION_CURRENCY}).
# Example:
2026-08-01, buy, Ascended Heroes ETB, 1, 2m
2026-08-05, sell, Ascended Heroes ETB, 1, 2.5m`;

function parseRow(
  line: string,
  existing: Existing[],
  defaultCurrency: string,
): Row | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const parts = trimmed.split(/\t|,/).map((s) => s.trim());
  if (parts.length < 5) {
    return { ok: false, raw: line, error: "Need at least 5 columns" };
  }
  const [dateRaw, typeRaw, name, qtyRaw, total, currencyRaw] = parts;
  const date = new Date(dateRaw);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, raw: line, error: `Bad date: ${dateRaw}` };
  }
  const type = typeRaw.toLowerCase();
  if (type !== "buy" && type !== "sell") {
    return { ok: false, raw: line, error: `Type must be buy or sell` };
  }
  const quantity = Number(qtyRaw);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, raw: line, error: `Bad quantity: ${qtyRaw}` };
  }
  const currency = (currencyRaw ?? defaultCurrency).toUpperCase();
  const nameLower = name.toLowerCase();
  const match =
    existing.find((it) => it.name.toLowerCase() === nameLower) ??
    existing.find((it) => it.name.toLowerCase().includes(nameLower));
  return {
    ok: true,
    date: date.toISOString(),
    type,
    itemName: name,
    matchedId: match?.id ?? null,
    quantity,
    total,
    currency,
  };
}

export function BulkPasteButton({ existing }: { existing: Existing[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => {
    return text
      .split(/\r?\n/)
      .map((line) => parseRow(line, existing, DEFAULT_TRANSACTION_CURRENCY))
      .filter((r): r is Row => r != null);
  }, [text, existing]);

  const validRows = rows.filter((r): r is Parsed => r.ok);
  const willCreate = validRows.filter((r) => !r.matchedId).length;

  function commit() {
    if (validRows.length === 0) return;
    startTransition(async () => {
      const res = await createTransactionsBulk(
        validRows.map((r) => ({
          itemId: r.matchedId,
          itemName: r.itemName,
          type: r.type,
          quantity: r.quantity,
          finalValue: r.total,
          currency: r.currency,
          occurredAt: r.date,
        })),
      );
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      const { createdCount, createdItems, errors } = res.data;
      if (errors.length > 0) {
        toast.show({
          kind: "error",
          message: `${createdCount} added, ${errors.length} failed. First error: row ${errors[0].row}: ${errors[0].message}`,
          durationMs: 12_000,
        });
      } else {
        toast.show({
          kind: "success",
          message:
            createdItems > 0
              ? `Added ${createdCount} transactions (${createdItems} new items)`
              : `Added ${createdCount} transactions`,
        });
      }
      setOpen(false);
      setText("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        Paste bulk
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-start justify-center p-6 overflow-y-auto"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-3xl bg-white dark:bg-zinc-950 rounded-lg shadow-xl p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Paste transactions</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm text-zinc-500 hover:underline"
          >
            Cancel
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          className="w-full font-mono text-xs px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700"
        />
        {rows.length > 0 && (
          <div className="max-h-64 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="text-left px-2 py-1">Date</th>
                  <th className="text-left px-2 py-1">Type</th>
                  <th className="text-left px-2 py-1">Item</th>
                  <th className="text-right px-2 py-1">Qty</th>
                  <th className="text-right px-2 py-1">Total</th>
                  <th className="text-left px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rows.map((r, i) =>
                  r.ok ? (
                    <tr key={i}>
                      <td className="px-2 py-1 text-zinc-500 whitespace-nowrap">
                        {new Date(r.date).toLocaleDateString()}
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className={
                            r.type === "buy"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }
                        >
                          {r.type}
                        </span>
                      </td>
                      <td className="px-2 py-1">{r.itemName}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.quantity}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.total} {r.currency}
                      </td>
                      <td className="px-2 py-1 text-[10px]">
                        {r.matchedId ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            ✓ matched
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">
                            + will create
                          </span>
                        )}
                      </td>
                    </tr>
                  ) : (
                    <tr key={i} className="bg-rose-50 dark:bg-rose-950/20">
                      <td
                        colSpan={6}
                        className="px-2 py-1 text-rose-700 dark:text-rose-400"
                      >
                        Skipped: {r.error} — <code>{r.raw}</code>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            {validRows.length > 0 ? (
              <>
                {validRows.length} valid row{validRows.length === 1 ? "" : "s"}
                {willCreate > 0 &&
                  ` · ${willCreate} new item${willCreate === 1 ? "" : "s"}`}
              </>
            ) : (
              "Paste rows above."
            )}
          </div>
          <button
            type="button"
            onClick={commit}
            disabled={pending || validRows.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
          >
            {pending ? "Committing…" : `Commit ${validRows.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
