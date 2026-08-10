"use client";

/**
 * "Merge into…" flow. Opens a small dialog with a typeahead of other
 * items; on confirm, calls mergeItems and redirects to the target.
 * The source item's transactions, market prices, mentions, aliases,
 * and tags all move to the target; the source row is deleted.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeItems } from "@/lib/server/items";
import { useToast } from "@/components/Toast";

type Target = { id: string; name: string };

export function MergeItemButton({
  sourceId,
  sourceName,
  targets,
}: {
  sourceId: string;
  sourceName: string;
  targets: Target[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return targets.slice(0, 8);
    return targets
      .filter((t) => t.name.toLowerCase().includes(term))
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(term) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(term) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.name.length - b.name.length;
      })
      .slice(0, 8);
  }, [targets, q]);

  const picked = targets.find((t) => t.id === pickedId) ?? null;

  function doMerge() {
    if (!picked) return;
    if (
      !confirm(
        `Merge "${sourceName}" into "${picked.name}"?\n\nAll transactions, prices, mentions, aliases, and tags will move to "${picked.name}", and "${sourceName}" will be deleted. This cannot be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await mergeItems(sourceId, picked.id);
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      toast.show({
        kind: "success",
        message: `Merged "${sourceName}" into "${picked.name}"`,
      });
      router.push(`/items/${res.data.targetId}`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-2"
      >
        Merge into…
      </button>
    );
  }

  return (
    <div className="inline-flex flex-col gap-2 border border-zinc-300 dark:border-zinc-700 rounded p-2 bg-white dark:bg-zinc-900 w-72">
      <div className="text-xs text-zinc-500">
        Merge <span className="font-medium">{sourceName}</span> into…
      </div>
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPickedId(null);
        }}
        placeholder="Search target item…"
        className="h-8 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700"
        autoComplete="off"
      />
      <ul className="max-h-40 overflow-y-auto text-xs">
        {hits.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setPickedId(t.id)}
              className={`w-full text-left px-2 py-1 rounded ${
                pickedId === t.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {t.name}
            </button>
          </li>
        ))}
        {hits.length === 0 && (
          <li className="px-2 py-1 text-zinc-500">No matches.</li>
        )}
      </ul>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQ("");
            setPickedId(null);
          }}
          className="text-xs text-zinc-500 hover:underline"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={doMerge}
          disabled={!picked || pending}
          className="text-xs font-medium rounded px-2 py-1 bg-rose-600 text-white disabled:opacity-50"
        >
          {pending ? "Merging…" : "Merge"}
        </button>
      </div>
    </div>
  );
}
