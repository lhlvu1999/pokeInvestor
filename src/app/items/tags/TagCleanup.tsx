"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeTagEverywhere, renameTagEverywhere } from "@/lib/server/set_tag_actions";

type Row = { tag: string; count: number };

/**
 * Every tag you have that is not being renamed to a set, with what it takes to tidy
 * it: take it off every item, or rename it (naming an existing tag merges the two).
 * Nothing happens until you confirm.
 */
export function TagCleanup({ rows, suggestions }: { rows: Row[]; suggestions: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function remove(r: Row) {
    if (
      !confirm(
        `Take the tag "${r.tag}" off its ${r.count} item${r.count === 1 ? "" : "s"}? The items stay; only the tag goes.`,
      )
    )
      return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await removeTagEverywhere(r.tag);
      if (!res.ok) setErr(res.error);
      else {
        setMsg(`Removed "${r.tag}" from ${res.data.items} item${res.data.items === 1 ? "" : "s"}.`);
        router.refresh();
      }
    });
  }

  function rename(r: Row) {
    const to = name.trim();
    if (!to) return;
    if (
      !confirm(
        `Rename "${r.tag}" to "${to.toLowerCase()}" on ${r.count} item${r.count === 1 ? "" : "s"}? If a tag with that name exists, the two are merged.`,
      )
    )
      return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await renameTagEverywhere(r.tag, to);
      if (!res.ok) setErr(res.error);
      else {
        setMsg(`Renamed "${r.tag}" to "${res.data.into}" on ${res.data.items} item${res.data.items === 1 ? "" : "s"}.`);
        setEditing(null);
        setName("");
        router.refresh();
      }
    });
  }

  if (rows.length === 0) return <p className="text-sm text-zinc-500">No other tags.</p>;

  return (
    <div>
      <datalist id="set-tag-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
        {rows.map((r) => (
          <li key={r.tag} className="py-2">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.tag}</span>{" "}
                <span className="text-zinc-500 text-xs">
                  {r.count} item{r.count === 1 ? "" : "s"}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setEditing(editing === r.tag ? null : r.tag);
                  setName("");
                }}
                className="text-xs text-sky-700 dark:text-sky-400 hover:underline disabled:opacity-50"
              >
                Rename or merge
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(r)}
                className="text-xs text-rose-700 dark:text-rose-400 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </div>
            {editing === r.tag && (
              <form
                className="mt-2 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(r);
                }}
              >
                <input
                  list="set-tag-suggestions"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="New name, or a set to merge into"
                  maxLength={40}
                  autoFocus
                  className="h-8 w-64 max-w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={pending || !name.trim()}
                  className="h-8 rounded px-3 text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
                >
                  Rename
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{msg}</p>}
      {err && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{err}</p>}
    </div>
  );
}
