"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Select } from "@/components/ui";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Money } from "@/components/Money";
import { parseCsv } from "@/lib/csv";
import {
  buildPreview,
  checkHeaderRow,
  type ImportPreview,
  type RawCsvRow,
} from "@/lib/import";
import { importParsedRows } from "@/lib/server/import";

type State =
  | { kind: "idle" }
  | { kind: "raw"; raw: RawCsvRow[]; fileName: string }
  | { kind: "headerError"; message: string };

function rowsFromCsv(text: string): {
  raw: RawCsvRow[];
  headerError: string | null;
} {
  const grid = parseCsv(text);
  if (grid.length === 0) return { raw: [], headerError: "Empty file" };
  const header = grid[0];
  const headerError = checkHeaderRow(header);
  if (headerError) return { raw: [], headerError };

  const lower = header.map((h) => h.trim().toLowerCase());
  const colIdx = (name: string) => lower.indexOf(name.toLowerCase());
  const idx = {
    item: colIdx("Item"),
    inStock: colIdx("In stock"),
    dateIn: colIdx("Date IN"),
    amountIn: colIdx("IN"),
    dateOut: colIdx("Date Out"),
    amountOut: colIdx("OUT"),
  };

  const raw: RawCsvRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    raw.push({
      item: r[idx.item] ?? "",
      inStock: r[idx.inStock] ?? "",
      dateIn: r[idx.dateIn] ?? "",
      amountIn: r[idx.amountIn] ?? "",
      dateOut: r[idx.dateOut] ?? "",
      amountOut: r[idx.amountOut] ?? "",
    });
  }
  return { raw, headerError: null };
}

export function ImportForm({ defaultCurrency }: { defaultCurrency: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [currency, setCurrency] = useState(defaultCurrency);
  const [multiplier, setMultiplier] = useState(1);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    itemsCreated: number;
    itemsReused: number;
    transactionsInserted: number;
  } | null>(null);

  const preview = useMemo(() => {
    if (state.kind !== "raw") return null;
    return buildPreview(state.raw, { valueMultiplier: multiplier });
  }, [state, multiplier]);

  async function onFileChange(file: File | null) {
    setSubmitError(null);
    setSuccess(null);
    if (!file) {
      setState({ kind: "idle" });
      return;
    }
    const text = await file.text();
    const { raw, headerError } = rowsFromCsv(text);
    if (headerError) {
      setState({ kind: "headerError", message: headerError });
      return;
    }
    setState({ kind: "raw", raw, fileName: file.name });
  }

  function onConfirm() {
    if (state.kind !== "raw" || !preview) return;
    setSubmitError(null);
    startTransition(async () => {
      const res = await importParsedRows({
        currency,
        rows: preview.rows.map((r) => ({
          itemDisplayName: r.itemDisplayName,
          transactions: r.transactions,
        })),
      });
      if (!res.ok) {
        setSubmitError(res.error);
        return;
      }
      setSuccess(res.data);
      setState({ kind: "idle" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Currency for all imported rows" htmlFor="import-currency">
            <CurrencyPicker
              id="import-currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </Field>

          <Field
            label="Value scale"
            htmlFor="import-scale"
            hint="If your CSV stores VND in thousands (e.g. 1850 means 1,850,000 ₫), pick ×1,000."
          >
            <Select
              id="import-scale"
              value={String(multiplier)}
              onChange={(e) => setMultiplier(Number(e.target.value))}
            >
              <option value="1">×1 (raw value)</option>
              <option value="1000">×1,000 (values are in thousands)</option>
              <option value="1000000">×1,000,000 (values are in millions)</option>
            </Select>
          </Field>
        </div>

        <Field label="CSV file" htmlFor="import-file">
          <input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </Field>
      </Card>

      {state.kind === "headerError" && (
        <Card className="p-4 border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-sm text-rose-700 dark:text-rose-300">
          {state.message}
        </Card>
      )}

      {success && (
        <Card className="p-4 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-sm text-emerald-700 dark:text-emerald-300">
          Imported {success.transactionsInserted} transactions across{" "}
          {success.itemsCreated} new + {success.itemsReused} existing items.
        </Card>
      )}

      {state.kind === "raw" && preview && (
        <PreviewView
          preview={preview}
          fileName={state.fileName}
          currency={currency}
          pending={pending}
          submitError={submitError}
          onConfirm={onConfirm}
        />
      )}
    </div>
  );
}

function PreviewView({
  preview,
  fileName,
  currency,
  pending,
  submitError,
  onConfirm,
}: {
  preview: ImportPreview;
  fileName: string;
  currency: string;
  pending: boolean;
  submitError: string | null;
  onConfirm: () => void;
}) {
  const { rows, errors, uniqueItems, totalBuys, totalSells } = preview;
  const totalInvested = rows.reduce((acc, r) => {
    const buy = r.transactions.find((t) => t.type === "buy");
    return acc + (buy ? buy.amountMinor : 0);
  }, 0);
  const totalRealized = rows.reduce((acc, r) => {
    const buy = r.transactions.find((t) => t.type === "buy");
    const sell = r.transactions.find((t) => t.type === "sell");
    if (!buy || !sell) return acc;
    return acc + (sell.amountMinor - buy.amountMinor);
  }, 0);

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-medium">{fileName}</div>
          <div className="text-xs text-zinc-500 mt-1">
            {rows.length} rows · {uniqueItems.length} unique items ·{" "}
            {totalBuys} buys + {totalSells} sells ·{" "}
            <span>
              spend <Money amount={totalInvested} currency={currency} />
            </span>{" "}
            · realized{" "}
            <Money
              amount={totalRealized}
              currency={currency}
              signed
            />
            {errors.length > 0 && (
              <span className="text-rose-600 dark:text-rose-400">
                {" "}
                · {errors.length} skipped
              </span>
            )}
          </div>
        </div>
        <Button onClick={onConfirm} disabled={pending || rows.length === 0}>
          {pending ? "Importing..." : `Import ${rows.length} rows`}
        </Button>
      </div>

      {submitError && (
        <div className="px-4 py-2 text-sm text-rose-600 dark:text-rose-400 border-b border-zinc-200 dark:border-zinc-800">
          {submitError}
        </div>
      )}

      <div className="max-h-[55vh] overflow-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500 sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-left">Buy date</th>
              <th className="px-3 py-2 text-right">Buy</th>
              <th className="px-3 py-2 text-left">Sell date</th>
              <th className="px-3 py-2 text-right">Sell</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.slice(0, 200).map((r) => {
              const buy = r.transactions.find((t) => t.type === "buy");
              const sell = r.transactions.find((t) => t.type === "sell");
              return (
                <tr key={r.rowIndex}>
                  <td className="px-3 py-1.5 text-zinc-400">{r.rowIndex}</td>
                  <td className="px-3 py-1.5">{r.itemDisplayName}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.quantity}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-500">
                    {buy?.occurredAt.toLocaleDateString()}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    <Money amount={buy?.amountMinor ?? null} currency={currency} />
                  </td>
                  <td className="px-3 py-1.5 text-zinc-500">
                    {sell?.occurredAt.toLocaleDateString() ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    <Money
                      amount={sell?.amountMinor ?? null}
                      currency={currency}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 200 && (
          <div className="px-3 py-2 text-xs text-zinc-500 border-t border-zinc-200 dark:border-zinc-800">
            Showing first 200 of {rows.length}. All rows will be imported.
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 max-h-[25vh] overflow-auto">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40">
            Skipped rows ({errors.length})
          </div>
          <ul className="text-xs divide-y divide-zinc-100 dark:divide-zinc-800">
            {errors.slice(0, 50).map((e) => (
              <li key={e.rowIndex} className="px-3 py-1.5">
                <span className="text-zinc-400">row {e.rowIndex}:</span>{" "}
                <span className="text-rose-600 dark:text-rose-400">{e.reason}</span>{" "}
                <span className="text-zinc-500">— {e.raw.item}</span>
              </li>
            ))}
            {errors.length > 50 && (
              <li className="px-3 py-1.5 text-zinc-500">
                ... and {errors.length - 50} more
              </li>
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}
