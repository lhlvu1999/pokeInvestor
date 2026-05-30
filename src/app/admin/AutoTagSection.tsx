"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { TagBadge } from "@/components/TagBadge";
import { applyAutoTag, type AutoTagPreview } from "@/lib/server/admin";

export function AutoTagSection({
  initialPreview,
}: {
  initialPreview: AutoTagPreview;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview] = useState(initialPreview);

  const perTagEntries = Object.entries(preview.perTag).sort(
    (a, b) => b[1] - a[1],
  );

  function apply() {
    if (preview.willChange === 0) {
      setErr("Nothing to do — all items already have their suggested tags.");
      return;
    }
    if (
      !confirm(
        `Apply auto-tag to ${preview.willChange} item(s)? Existing tags are preserved; only suggested tags missing from each item will be added.`,
      )
    ) {
      return;
    }
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      const res = await applyAutoTag();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(
        `Updated ${res.data.itemsUpdated} item(s); added ${res.data.tagsAdded} tag(s).`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-zinc-600 dark:text-zinc-300">
        Scans every item name and proposes tags based on common patterns
        (e.g. starts with <code>etb</code> → <TagBadge tag="etb" />, contains{" "}
        <code>booster</code> → <TagBadge tag="booster" />). Idempotent — safe
        to re-run.
      </div>

      {preview.willChange === 0 ? (
        <div className="text-sm text-zinc-500">
          Nothing to add — all {preview.totalItems} items already carry their
          suggested tags.
        </div>
      ) : (
        <>
          <div className="text-sm">
            <strong>{preview.willChange}</strong> of {preview.totalItems}{" "}
            item(s) would be tagged. Per tag:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {perTagEntries.map(([tag, count]) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs"
              >
                <TagBadge tag={tag} />
                <span className="text-zinc-500">×{count}</span>
              </span>
            ))}
          </div>
          {preview.sample.length > 0 && (
            <details className="text-xs text-zinc-600 dark:text-zinc-300">
              <summary className="cursor-pointer hover:underline">
                Preview first {preview.sample.length} changes
              </summary>
              <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-md max-h-64 overflow-auto">
                {preview.sample.map((s) => (
                  <li
                    key={s.itemId}
                    className="px-3 py-1.5 flex items-center justify-between gap-3"
                  >
                    <span className="truncate">{s.itemName}</span>
                    <span className="flex flex-wrap gap-1 shrink-0">
                      {s.addedTags.map((t) => (
                        <TagBadge key={t} tag={t} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-2">
            <Button onClick={apply} disabled={pending}>
              {pending
                ? "Applying..."
                : `Apply auto-tag to ${preview.willChange} item(s)`}
            </Button>
          </div>
        </>
      )}
      {msg && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>
      )}
      {err && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{err}</div>
      )}
    </div>
  );
}
