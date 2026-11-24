"use client";

import { useMemo, useState } from "react";
import { Button, Card, Checkbox, Select, TextInput } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { formatAmount } from "@/lib/currency";
import {
  buildSnapshot,
  DEFAULT_SHARE_OPTIONS,
  renderSnapshotHtml,
  renderSnapshotText,
  snapshotFilename,
  type ShareLine,
  type ShareOptions,
} from "@/lib/calc/share_snapshot";

export function ShareBuilder({
  lines,
  tags,
  currency,
  skipped,
  now,
}: {
  lines: ShareLine[];
  tags: string[];
  currency: string;
  skipped: number;
  now: number;
}) {
  const toast = useToast();
  const [options, setOptions] = useState<ShareOptions>(DEFAULT_SHARE_OPTIONS);
  const set = <K extends keyof ShareOptions>(k: K, v: ShareOptions[K]) =>
    setOptions((o) => ({ ...o, [k]: v }));

  const money = useMemo(
    () => (minor: number) => formatAmount(minor, currency),
    [currency],
  );
  const snapshot = useMemo(
    () => buildSnapshot(lines, options, currency, new Date(now)),
    [lines, options, currency, now],
  );
  const html = useMemo(
    () => renderSnapshotHtml(snapshot, money),
    [snapshot, money],
  );

  function download() {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = snapshotFilename(snapshot);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(renderSnapshotText(snapshot, money));
      toast.show({ kind: "success", message: "Snapshot copied as text" });
    } catch {
      toast.show({
        kind: "error",
        message: "Couldn't copy: your browser blocked clipboard access",
      });
    }
  }

  const empty = snapshot.rows.length === 0;
  const privateOn = options.showCost || options.showProfit;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
      <div className="lg:col-span-2 flex flex-col gap-4">
        <Card className="p-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Title</span>
            <TextInput
              value={options.title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={120}
            />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium mb-1">Show</legend>
            <Toggle
              checked={options.showQuantity}
              onChange={(v) => set("showQuantity", v)}
              label="Quantities"
            />
            <Toggle
              checked={options.showUnitPrice}
              onChange={(v) => set("showUnitPrice", v)}
              label="Market price per unit"
            />
            <Toggle
              checked={options.showValue}
              onChange={(v) => set("showValue", v)}
              label="Value at market price"
            />
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-lg border border-amber-300 dark:border-amber-800 p-3">
            <legend className="px-1 text-sm font-medium text-amber-700 dark:text-amber-400">
              Private: off unless you tick them
            </legend>
            <Toggle
              checked={options.showCost}
              onChange={(v) => set("showCost", v)}
              label="What you paid"
            />
            <Toggle
              checked={options.showProfit}
              onChange={(v) => set("showProfit", v)}
              label="Profit or loss"
            />
          </fieldset>

          {tags.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Which items</span>
              <Select
                value={options.tag ?? ""}
                onChange={(e) => set("tag", e.target.value || null)}
              >
                <option value="">Everything I hold</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    Only tagged “{t}”
                  </option>
                ))}
              </Select>
            </label>
          )}
        </Card>

        <Card className="p-4 text-sm">
          <h2 className="font-medium">What they will see</h2>
          <p className="mt-1 text-zinc-600 dark:text-zinc-300">
            {snapshot.includes.join(", ")}.
          </p>
          <h2 className="mt-3 font-medium">What they won&apos;t</h2>
          <p className="mt-1 text-zinc-600 dark:text-zinc-300">
            {snapshot.excludes.join(". ")}.
          </p>
          <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
            This is a copy, not a live link: the app has no login, so a link
            would not protect anything. Once sent, it can&apos;t be taken back.
          </p>
        </Card>

        {skipped > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {skipped} held {skipped === 1 ? "item is" : "items are"} left out:
            no exchange rate to show {skipped === 1 ? "it" : "them"} in{" "}
            {currency}.
          </p>
        )}
      </div>

      <div className="lg:col-span-3 flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium mr-auto">
            Preview{" "}
            <span className="text-xs font-normal text-zinc-500">
              exactly what they get
            </span>
          </h2>
          <Button variant="secondary" onClick={copy} disabled={empty}>
            Copy as text
          </Button>
          <Button onClick={download} disabled={empty}>
            Download file
          </Button>
        </div>
        {privateOn && (
          <p
            role="status"
            className="text-xs rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-3 py-2"
          >
            This snapshot includes{" "}
            {[
              options.showCost && "what you paid",
              options.showProfit && "your profit or loss",
            ]
              .filter(Boolean)
              .join(" and ")}
            . Only send it to someone you&apos;re happy to show that to.
          </p>
        )}
        {/* The recipient's file in a frame with no scripts and no access to
            this page, so the preview can't differ from what is sent. */}
        <iframe
          title="Snapshot preview"
          sandbox=""
          srcDoc={html}
          className="w-full h-[70vh] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white"
        />
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
      <Checkbox
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
