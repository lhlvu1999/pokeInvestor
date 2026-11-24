"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Checkbox, Field, TextInput } from "@/components/ui";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Money } from "@/components/Money";
import { buildPreview, transformRow, type RawCsvRow } from "@/lib/import";
import { MAX_IMAGES, type ExtractedRow } from "@/lib/screenshot_import";
import { importParsedRows } from "@/lib/server/import";
import { extractFromScreenshots, type VisionStatus } from "@/lib/server/vision";

type Thumb = { name: string; url: string };

type ReviewRow = {
  id: number;
  item: string;
  qty: string;
  dateIn: string;
  amountIn: string;
  dateOut: string;
  amountOut: string;
  confirmed: boolean;
  removed: boolean;
};

let nextId = 1;
function toReview(r: ExtractedRow): ReviewRow {
  return {
    id: nextId++,
    item: r.item,
    qty: String(r.quantity),
    dateIn: r.dateIn,
    amountIn: String(r.amountIn),
    dateOut: r.dateOut ?? "",
    amountOut: r.amountOut == null ? "" : String(r.amountOut),
    confirmed: false,
    removed: false,
  };
}

/** One review row as the importer's raw row, so it is checked by the same rules. */
function rawOf(r: ReviewRow): RawCsvRow {
  const q = Number(r.qty);
  return {
    item: Number.isInteger(q) && q > 1 ? `${r.item.trim()} x ${q}` : r.item,
    inStock: "",
    dateIn: r.dateIn,
    amountIn: r.amountIn,
    dateOut: r.dateOut,
    amountOut: r.amountOut,
  };
}

/** Shrink a screenshot to a sensible size and re-encode it. This keeps the
 * upload small and drops any metadata the file carried. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * Read purchases and sales out of screenshots, then review every row.
 *
 * A model can misread a digit or make a row up, so nothing is saved until
 * each row has been looked at and ticked, and editing a row un-ticks it.
 */
export function ScreenshotImport({
  status,
  defaultCurrency,
}: {
  status: VisionStatus;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const filesRef = useRef<File[]>([]);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [rejected, setRejected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  // Free the preview images when the list changes or the page goes away.
  useEffect(
    () => () => thumbs.forEach((t) => URL.revokeObjectURL(t.url)),
    [thumbs],
  );

  function onPick(list: FileList | null) {
    setError(null);
    setDone(null);
    setRows(null);
    const files = Array.from(list ?? []).slice(0, MAX_IMAGES);
    if ((list?.length ?? 0) > MAX_IMAGES)
      setError(`Only the first ${MAX_IMAGES} screenshots are used.`);
    filesRef.current = files;
    setThumbs(
      files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    );
  }

  function read() {
    setError(null);
    setDone(null);
    startReading(async () => {
      let images: string[];
      try {
        images = await Promise.all(filesRef.current.map(shrink));
      } catch {
        setError("One of those files couldn't be opened as an image.");
        return;
      }
      const res = await extractFromScreenshots({ images });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRejected(res.data.rejected);
      setRows(res.data.rows.map(toReview));
    });
  }

  function edit(id: number, patch: Partial<ReviewRow>) {
    setRows(
      (rs) =>
        rs?.map((r) =>
          r.id === id
            ? // Changing anything means the row has to be looked at again.
              { ...r, ...patch, confirmed: patch.confirmed ?? false }
            : r,
        ) ?? null,
    );
  }

  const live = useMemo(() => (rows ?? []).filter((r) => !r.removed), [rows]);
  const problems = useMemo(() => {
    const m = new Map<number, string>();
    live.forEach((r, i) => {
      const t = transformRow(rawOf(r), i + 1, {});
      if (t && "reason" in t) m.set(r.id, t.reason);
      else if (t === null) m.set(r.id, "This row is empty.");
    });
    return m;
  }, [live]);
  const confirmedCount = live.filter((r) => r.confirmed).length;
  const ready =
    live.length > 0 && confirmedCount === live.length && problems.size === 0;

  const preview = useMemo(
    () => (ready ? buildPreview(live.map(rawOf)) : null),
    [ready, live],
  );

  function save() {
    if (!preview) return;
    setError(null);
    startSaving(async () => {
      const res = await importParsedRows({
        currency,
        rows: preview.rows.map((r) => ({
          itemDisplayName: r.itemDisplayName,
          transactions: r.transactions,
        })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(
        `Imported ${res.data.transactionsInserted} transactions across ${res.data.itemsCreated} new and ${res.data.itemsReused} existing items.`,
      );
      setRows(null);
      setThumbs([]);
      filesRef.current = [];
      router.refresh();
    });
  }

  if (!status.configured) {
    return (
      <Card className="p-5 text-sm">
        <h2 className="font-medium">From screenshots</h2>
        <p className="mt-1 text-zinc-600 dark:text-zinc-300 max-w-prose leading-relaxed">
          Reading screenshots needs a model that can see images, and none is set
          up. Add it to <code>.env</code> and restart the app:
        </p>
        <pre className="mt-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3 text-xs overflow-x-auto">
          {`VISION_MODEL=gpt-4o-mini
# only if it isn't your usual LLM server:
# VISION_BASE_URL=https://api.openai.com/v1
# VISION_API_KEY=sk-...`}
        </pre>
        <p className="mt-2 text-xs text-zinc-500 max-w-prose">
          A local model that reads images works too (for example a
          vision-capable model in Ollama, with its address as{" "}
          <code>VISION_BASE_URL</code>); then nothing leaves your computer.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div>
        <h2 className="font-medium">From screenshots</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300 max-w-prose">
          Choose up to {MAX_IMAGES} screenshots of an order history or sales
          list. The rows it reads are shown for you to check and tick one by
          one; nothing is saved until you do.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Screenshots" htmlFor="shots">
          <input
            id="shots"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => onPick(e.target.files)}
            className="text-sm"
          />
        </Field>
        <Field label="Currency of the amounts" htmlFor="shots-currency">
          <CurrencyPicker
            id="shots-currency"
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
        </Field>
      </div>

      {thumbs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {thumbs.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={t.url}
              src={t.url}
              alt={t.name}
              className="h-24 w-auto rounded-md border border-zinc-200 dark:border-zinc-800 object-cover"
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={read} disabled={reading || thumbs.length === 0}>
          {reading
            ? "Reading…"
            : `Read ${thumbs.length || ""} screenshot${thumbs.length === 1 ? "" : "s"}`.replace(
                "  ",
                " ",
              )}
        </Button>
        <p className="text-xs text-zinc-500 max-w-prose">
          {status.local
            ? `Read by ${status.model} on this computer.`
            : `Sent to ${status.host} (${status.model}) to be read; this app doesn't keep them.`}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      {done && (
        <p
          role="status"
          className="text-sm text-emerald-700 dark:text-emerald-300"
        >
          {done}
        </p>
      )}

      {rows && (
        <Review
          rows={rows}
          live={live}
          problems={problems}
          rejected={rejected}
          confirmedCount={confirmedCount}
          ready={ready}
          currency={currency}
          saving={saving}
          onEdit={edit}
          onConfirmAll={() =>
            setRows(
              (rs) =>
                rs?.map((r) => (r.removed ? r : { ...r, confirmed: true })) ??
                null,
            )
          }
          onSave={save}
        />
      )}
    </Card>
  );
}

function Review({
  rows,
  live,
  problems,
  rejected,
  confirmedCount,
  ready,
  currency,
  saving,
  onEdit,
  onConfirmAll,
  onSave,
}: {
  rows: ReviewRow[];
  live: ReviewRow[];
  problems: Map<number, string>;
  rejected: number;
  confirmedCount: number;
  ready: boolean;
  currency: string;
  saving: boolean;
  onEdit: (id: number, patch: Partial<ReviewRow>) => void;
  onConfirmAll: () => void;
  onSave: () => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        No purchases or sales could be read
        {rejected > 0 ? ` (${rejected} unclear rows were skipped)` : ""}. Try a
        sharper or larger screenshot, or one with fewer columns cut off.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <span className="font-medium">
            {confirmedCount} of {live.length} checked
          </span>
          {rejected > 0 && (
            <span className="text-zinc-500">
              {" "}
              · {rejected} unclear {rejected === 1 ? "row was" : "rows were"}{" "}
              skipped
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onConfirmAll}
          className="text-xs text-zinc-500 hover:underline"
        >
          I&apos;ve checked them all
        </button>
        <Button
          className="sm:ml-auto"
          disabled={!ready || saving}
          onClick={onSave}
        >
          {saving
            ? "Importing…"
            : `Import ${live.length} ${live.length === 1 ? "row" : "rows"}`}
        </Button>
      </div>
      {!ready && live.length > 0 && (
        <p className="text-xs text-zinc-500">
          {problems.size > 0
            ? "Fix the rows marked in red to continue."
            : "Tick every row once you've compared it with the screenshot."}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((r) =>
          r.removed ? null : (
            <li
              key={r.id}
              className={`rounded-lg border p-3 ${
                problems.has(r.id)
                  ? "border-rose-300 dark:border-rose-800"
                  : r.confirmed
                    ? "border-emerald-300 dark:border-emerald-900"
                    : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <label className="col-span-2 sm:col-span-3 flex flex-col gap-1 text-xs text-zinc-500">
                  Item
                  <TextInput
                    value={r.item}
                    onChange={(e) => onEdit(r.id, { item: e.target.value })}
                    className="h-9"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  Quantity
                  <TextInput
                    inputMode="numeric"
                    value={r.qty}
                    onChange={(e) => onEdit(r.id, { qty: e.target.value })}
                    className="h-9 tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  Bought
                  <TextInput
                    type="date"
                    value={r.dateIn}
                    onChange={(e) => onEdit(r.id, { dateIn: e.target.value })}
                    className="h-9"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  Paid (total)
                  <TextInput
                    inputMode="decimal"
                    value={r.amountIn}
                    onChange={(e) => onEdit(r.id, { amountIn: e.target.value })}
                    className="h-9 tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  Sold
                  <TextInput
                    type="date"
                    value={r.dateOut}
                    onChange={(e) => onEdit(r.id, { dateOut: e.target.value })}
                    className="h-9"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  Received (total)
                  <TextInput
                    inputMode="decimal"
                    value={r.amountOut}
                    onChange={(e) =>
                      onEdit(r.id, { amountOut: e.target.value })
                    }
                    className="h-9 tabular-nums"
                  />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox
                    checked={r.confirmed}
                    disabled={problems.has(r.id)}
                    onChange={(e) =>
                      onEdit(r.id, { confirmed: e.target.checked })
                    }
                  />
                  Matches the screenshot
                </label>
                {problems.has(r.id) && (
                  <span className="text-xs text-rose-600 dark:text-rose-400">
                    {problems.get(r.id)}
                  </span>
                )}
                {!problems.has(r.id) && r.amountIn !== "" && (
                  <span className="text-xs text-zinc-500 tabular-nums">
                    paid{" "}
                    <Money
                      amount={Math.round(Number(r.amountIn))}
                      currency={currency}
                    />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onEdit(r.id, { removed: true })}
                  className="ml-auto text-xs text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400"
                >
                  Remove row
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
