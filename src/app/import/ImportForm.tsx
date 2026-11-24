"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Select, Textarea } from "@/components/ui";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Money } from "@/components/Money";
import { detectDelimiter, parseCsv } from "@/lib/csv";
import {
  buildPreview,
  detectDateOrder,
  IMPORT_TEMPLATE_CSV,
  mapHeader,
  type DateOrder,
  type ImportPreview,
  type RawCsvRow,
} from "@/lib/import";
import { importParsedRows } from "@/lib/server/import";

type State =
  | {
      kind: "raw";
      raw: RawCsvRow[];
      source: string;
      /** Columns read under another name, and columns not used. */
      renamed: { found: string; as: string }[];
      ignored: string[];
    }
  | { kind: "idle" }
  | { kind: "headerError"; message: string };

type DateChoice = "auto" | DateOrder;

/** Read file or pasted text: any of comma, tab or semicolon separated. */
function rowsFromText(text: string):
  | {
      ok: true;
      raw: RawCsvRow[];
      renamed: { found: string; as: string }[];
      ignored: string[];
    }
  | { ok: false; message: string } {
  const grid = parseCsv(text, detectDelimiter(text));
  if (grid.length === 0)
    return {
      ok: false,
      message: "There's nothing to read: the file or box is empty.",
    };
  const map = mapHeader(grid[0]);
  if (!map.ok) return { ok: false, message: map.message };
  const at = (r: string[], f: keyof typeof map.index) =>
    (map.index[f] != null ? r[map.index[f]!] : "") ?? "";
  const raw: RawCsvRow[] = grid.slice(1).map((r) => ({
    item: at(r, "item"),
    inStock: at(r, "inStock"),
    dateIn: at(r, "dateIn"),
    amountIn: at(r, "amountIn"),
    dateOut: at(r, "dateOut"),
    amountOut: at(r, "amountOut"),
  }));
  return { ok: true, raw, renamed: map.renamed, ignored: map.ignored };
}

const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE_CSV)}`;

export function ImportForm({ defaultCurrency }: { defaultCurrency: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [currency, setCurrency] = useState(defaultCurrency);
  const [multiplier, setMultiplier] = useState(1);
  const [dateChoice, setDateChoice] = useState<DateChoice>("auto");
  const [pasted, setPasted] = useState("");
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    itemsCreated: number;
    itemsReused: number;
    transactionsInserted: number;
  } | null>(null);

  // Day-first vs month-first is read from the file's own dates when they
  // settle it; otherwise it is a guess the person is asked to confirm.
  const guess = useMemo(() => {
    if (state.kind !== "raw") return null;
    return detectDateOrder(
      state.raw.flatMap((r) => [r.dateIn, r.dateOut]).filter(Boolean),
    );
  }, [state]);
  const dateOrder: DateOrder =
    dateChoice === "auto" ? (guess?.order ?? "mdy") : dateChoice;

  const preview = useMemo(() => {
    if (state.kind !== "raw") return null;
    return buildPreview(state.raw, { valueMultiplier: multiplier, dateOrder });
  }, [state, multiplier, dateOrder]);

  function load(text: string, source: string) {
    setSubmitError(null);
    setSuccess(null);
    const res = rowsFromText(text);
    if (!res.ok) {
      setState({ kind: "headerError", message: res.message });
      return;
    }
    setState({
      kind: "raw",
      raw: res.raw,
      source,
      renamed: res.renamed,
      ignored: res.ignored,
    });
  }

  async function onFileChange(file: File | null) {
    setSubmitError(null);
    setSuccess(null);
    if (!file) {
      setState({ kind: "idle" });
      return;
    }
    load(await file.text(), file.name);
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
          <Field
            label="Currency for all imported rows"
            htmlFor="import-currency"
          >
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
              <option value="1000000">
                ×1,000,000 (values are in millions)
              </option>
            </Select>
          </Field>
        </div>

        <Field
          label="How dates are written"
          htmlFor="import-date-order"
          hint={
            guess?.certain
              ? `Read from your file: ${guess.order === "dmy" ? "day first (25/9/2025)" : "month first (9/25/2025)"}.`
              : "Auto works it out from the file when it can (a date like 25/9 settles it)."
          }
        >
          <Select
            id="import-date-order"
            value={dateChoice}
            onChange={(e) => setDateChoice(e.target.value as DateChoice)}
          >
            <option value="auto">Work it out from the file</option>
            <option value="mdy">Month first: 9/25/2025</option>
            <option value="dmy">Day first: 25/9/2025</option>
          </Select>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Upload a file"
            htmlFor="import-file"
            hint="CSV, or any text file with the same columns."
          >
            <input
              id="import-file"
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </Field>
          <div className="text-sm text-zinc-600 dark:text-zinc-300 sm:pt-6">
            Not sure of the layout?{" "}
            <a
              href={TEMPLATE_HREF}
              download="pokeinvestor-import-template.csv"
              className="underline hover:no-underline"
            >
              Download a template
            </a>{" "}
            and fill it in.
          </div>
        </div>

        <Field
          label="Or paste from a spreadsheet"
          htmlFor="import-paste"
          hint="Select the cells in Excel or Google Sheets, including the header row, copy, and paste here."
        >
          <Textarea
            id="import-paste"
            rows={4}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"Item\tDate IN\tIN\tDate Out\tOUT"}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </Field>
        <div>
          <Button
            variant="secondary"
            disabled={pasted.trim() === ""}
            onClick={() => load(pasted, "Pasted rows")}
          >
            Read pasted rows
          </Button>
        </div>
      </Card>

      {state.kind === "headerError" && (
        <Card
          role="alert"
          className="p-4 border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-sm text-rose-700 dark:text-rose-300"
        >
          {state.message}
        </Card>
      )}

      {state.kind === "raw" &&
        guess &&
        !guess.certain &&
        dateChoice === "auto" && (
          <Card
            role="status"
            className="p-4 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-800 dark:text-amber-300"
          >
            Every date in this file could be read either way, so I&apos;m
            reading them {dateOrder === "dmy" ? "day first" : "month first"}.
            Check the dates in the preview below; if they look swapped, change{" "}
            <strong>How dates are written</strong> above.
          </Card>
        )}

      {state.kind === "raw" &&
        (state.renamed.length > 0 || state.ignored.length > 0) && (
          <div className="text-xs text-zinc-500 leading-relaxed">
            {state.renamed.length > 0 && (
              <p>
                Read{" "}
                {state.renamed.map((r) => `“${r.found}” as ${r.as}`).join(", ")}
                .
              </p>
            )}
            {state.ignored.length > 0 && (
              <p>Not used: {state.ignored.map((c) => `“${c}”`).join(", ")}.</p>
            )}
          </div>
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
          fileName={state.source}
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
            {rows.length} rows · {uniqueItems.length} unique items · {totalBuys}{" "}
            buys + {totalSells} sells ·{" "}
            <span>
              spend <Money amount={totalInvested} currency={currency} />
            </span>{" "}
            · realized{" "}
            <Money amount={totalRealized} currency={currency} signed />
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
                    <Money
                      amount={buy?.amountMinor ?? null}
                      currency={currency}
                    />
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
                <span className="text-rose-600 dark:text-rose-400">
                  {e.reason}
                </span>{" "}
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
