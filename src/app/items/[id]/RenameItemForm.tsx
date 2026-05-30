"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameItem } from "@/lib/server/items";

export function RenameItemForm({
  id,
  currentName,
  existingNames,
}: {
  id: string;
  currentName: string;
  /** All other item names in the system, used to warn before a merge. */
  existingNames: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function normalize(s: string) {
    return s.trim().toLowerCase().normalize("NFKC");
  }

  function findMergeTarget(): { id: string; name: string } | null {
    const key = normalize(value);
    if (key === normalize(currentName)) return null;
    return (
      existingNames.find((n) => n.id !== id && normalize(n.name) === key) ??
      null
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = value.trim();
    if (trimmed === "") {
      setError("Name cannot be empty");
      return;
    }
    if (trimmed === currentName) {
      setEditing(false);
      return;
    }
    const target = findMergeTarget();
    if (target) {
      const ok = confirm(
        `An item named "${target.name}" already exists. Merge "${currentName}" into it? All transactions and price history from "${currentName}" will move into "${target.name}", and "${currentName}" will be deleted.`,
      );
      if (!ok) return;
    }
    startTransition(async () => {
      const res = await renameItem({ id, newName: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.merged) {
        router.push(`/items/${res.data.itemId}`);
        router.refresh();
      } else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          setValue(currentName);
          setError(null);
        }}
        className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline-offset-2 hover:underline"
        title="Rename this item"
      >
        Rename
      </button>
    );
  }

  const target = findMergeTarget();
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          disabled={pending}
          className="h-9 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 min-w-[280px]"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md px-3 h-9 text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? "Saving..." : target ? "Merge" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          disabled={pending}
          className="text-sm text-zinc-500 hover:underline"
        >
          Cancel
        </button>
      </div>
      {target && (
        <div className="text-xs text-amber-700 dark:text-amber-400">
          Will merge into existing item “{target.name}”.
        </div>
      )}
      {error && (
        <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>
      )}
    </form>
  );
}
