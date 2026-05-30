"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setItemTags } from "@/lib/server/items";
import { TagBadge } from "@/components/TagBadge";

export function TagEditor({
  itemId,
  initialTags,
  knownTags,
}: {
  itemId: string;
  initialTags: string[];
  /** Other tags in the system, used for autocomplete suggestions. */
  knownTags: string[];
}) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const term = draft.trim().toLowerCase();
    if (!term) return [];
    return knownTags
      .filter((t) => !tags.includes(t) && t.includes(term))
      .slice(0, 5);
  }, [draft, knownTags, tags]);

  function commit(newTags: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await setItemTags(itemId, newTags);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTags(res.data);
      router.refresh();
    });
  }

  function addTag(raw: string) {
    const t = raw.trim().toLowerCase();
    if (!t) return;
    if (tags.includes(t)) {
      setDraft("");
      return;
    }
    if (tags.length >= 12) {
      setError("Up to 12 tags per item.");
      return;
    }
    if (t.length > 24) {
      setError("Tags must be 24 characters or fewer.");
      return;
    }
    const next = [...tags, t];
    setDraft("");
    commit(next);
  }

  function removeTag(t: string) {
    commit(tags.filter((x) => x !== t));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <TagBadge
            key={t}
            tag={t}
            onRemove={pending ? undefined : () => removeTag(t)}
          />
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) addTag(draft);
          }}
          placeholder={tags.length === 0 ? "Add tag..." : "Add..."}
          disabled={pending}
          className="text-xs h-6 px-2 rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 min-w-[100px]"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-zinc-500 self-center mr-1">Suggest:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              // Prevent the input from blurring before our click runs —
              // otherwise the input's onBlur would commit the partial draft
              // ("boo") instead of the clicked suggestion ("booster box").
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(s);
              }}
              className="text-[10px] rounded-full px-2 py-0.5 border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>
      )}
    </div>
  );
}
