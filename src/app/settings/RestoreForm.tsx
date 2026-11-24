"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type TableRow = {
  name: string;
  label: string;
  inFile: number;
  existing: number;
  inDatabase: number;
};
type Reply = {
  applied?: boolean;
  createdAt?: string;
  tables?: TableRow[];
  error?: string;
};

const CONFIRM_WORD = "RESTORE";

/**
 * Pick a backup file, see exactly what restoring it would do, then confirm by
 * typing a word. The first step changes nothing.
 */
export function RestoreForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Reply | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Reply | null>(null);

  async function send(f: File, confirm: boolean): Promise<Reply> {
    const body = new FormData();
    body.set("file", f);
    if (confirm) body.set("confirm", CONFIRM_WORD);
    const res = await fetch("/api/backup/restore", { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as Reply;
    if (!res.ok) throw new Error(json.error ?? "The file could not be read.");
    return json;
  }

  async function choose(f: File | undefined) {
    setFile(f ?? null);
    setPreview(null);
    setDone(null);
    setError(null);
    setTyped("");
    if (!f) return;
    setBusy(true);
    try {
      setPreview(await send(f, false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await send(file, true));
      setPreview(null);
      setFile(null);
      setTyped("");
      if (input.current) input.current.value = "";
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The restore failed.");
    } finally {
      setBusy(false);
    }
  }

  const changed = preview?.tables?.filter((t) => t.inFile > 0) ?? [];
  const adds = changed.reduce((n, t) => n + t.inFile - t.existing, 0);
  const overwrites = changed.reduce((n, t) => n + t.existing, 0);

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        onChange={(e) => choose(e.target.files?.[0])}
        disabled={busy}
        aria-label="Backup file"
        className="text-xs file:mr-3 file:rounded-md file:border file:border-zinc-300 dark:file:border-zinc-700 file:bg-transparent file:px-3 file:py-1.5 file:text-xs file:font-medium"
      />

      {busy && !preview && <p className="text-xs text-zinc-500">Reading the file…</p>}

      {preview?.tables && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-xs">
          <p className="text-zinc-600 dark:text-zinc-400">
            {`Backup made ${new Date(preview.createdAt ?? 0).toLocaleString()}. Restoring will add ${adds.toLocaleString()} ${adds === 1 ? "row" : "rows"} and overwrite ${overwrites.toLocaleString()} that already exist. Nothing is deleted.`}
          </p>
          <table className="mt-2 w-full">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left font-medium py-1">Part</th>
                <th className="text-right font-medium py-1">In file</th>
                <th className="text-right font-medium py-1">Added</th>
                <th className="text-right font-medium py-1">Overwritten</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {changed.map((t) => (
                <tr key={t.name}>
                  <td className="py-1">{t.label}</td>
                  <td className="py-1 text-right tabular-nums">{t.inFile.toLocaleString()}</td>
                  <td className="py-1 text-right tabular-nums">
                    {(t.inFile - t.existing).toLocaleString()}
                  </td>
                  <td className="py-1 text-right tabular-nums">{t.existing.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-zinc-500 leading-relaxed">
            Rows you added after this backup stay. Rows that share an id with one in the file are
            put back to how the file has them, so edits made since then to those rows are undone.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`Type ${CONFIRM_WORD} to confirm`}
              aria-label={`Type ${CONFIRM_WORD} to confirm`}
              disabled={busy}
              className="h-8 w-52 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-xs"
            />
            <button
              type="button"
              onClick={apply}
              disabled={busy || typed !== CONFIRM_WORD}
              className="h-8 rounded-md px-3 text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
            >
              {busy ? "Restoring…" : "Restore"}
            </button>
          </div>
        </div>
      )}

      {done?.tables && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          {`Restored. ${done.tables.reduce((n, t) => n + t.inFile, 0).toLocaleString()} rows from the backup are in place.`}
        </p>
      )}
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
