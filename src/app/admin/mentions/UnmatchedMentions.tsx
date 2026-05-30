"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, TextInput } from "@/components/ui";
import {
  createItemAndLinkMentions,
  linkMentionsByRawName,
  searchItemsForLink,
  type ItemPick,
  type UnmatchedGroup,
} from "@/lib/server/insights";

export function UnmatchedMentions({ groups }: { groups: UnmatchedGroup[] }) {
  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
      {groups.map((g) => (
        <UnmatchedRow key={g.rawName} group={g} />
      ))}
    </div>
  );
}

function UnmatchedRow({ group }: { group: UnmatchedGroup }) {
  const router = useRouter();
  const [query, setQuery] = useState(group.rawName);
  const [options, setOptions] = useState<ItemPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function doSearch(value: string) {
    setQuery(value);
    setErr(null);
    setMsg(null);
    if (value.trim().length === 0) {
      setOptions([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchItemsForLink(value);
      setOptions(results);
    } finally {
      setSearching(false);
    }
  }

  function link(itemId: string) {
    setErr(null);
    startTransition(async () => {
      const res = await linkMentionsByRawName({
        rawName: group.rawName,
        itemId,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(`Linked ${res.data.updated} mention(s).`);
      router.refresh();
    });
  }

  function createNew() {
    setErr(null);
    const name = query.trim();
    if (name.length === 0) {
      setErr("Type a name for the new item.");
      return;
    }
    startTransition(async () => {
      const res = await createItemAndLinkMentions({
        rawName: group.rawName,
        name,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(`Created item and linked ${res.data.updated} mention(s).`);
      router.refresh();
    });
  }

  return (
    <div className="px-5 py-4 flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-medium">{group.rawName}</div>
        <div className="text-xs text-zinc-500">
          {group.count} mention{group.count === 1 ? "" : "s"} ·{" "}
          {group.topSentiment}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TextInput
          value={query}
          onChange={(e) => doSearch(e.target.value)}
          placeholder="Search items by name…"
          className="flex-1 h-9 text-sm"
        />
        <Button
          variant="secondary"
          onClick={createNew}
          disabled={pending || query.trim().length === 0}
          className="h-9 px-3 text-xs whitespace-nowrap"
        >
          {pending ? "Working…" : "Create new"}
        </Button>
      </div>

      {searching && (
        <div className="text-xs text-zinc-500">Searching…</div>
      )}
      {!searching && options.length > 0 && (
        <ul className="flex flex-col gap-1">
          {options.map((opt) => (
            <li
              key={opt.id}
              className="flex items-center justify-between gap-2 text-sm px-3 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium">{opt.name}</span>
                {opt.setCode && (
                  <span className="text-xs text-zinc-500 ml-2">
                    {opt.setCode}
                  </span>
                )}
              </div>
              <Button
                onClick={() => link(opt.id)}
                disabled={pending}
                className="h-7 px-2.5 text-xs"
              >
                Link
              </Button>
            </li>
          ))}
        </ul>
      )}

      {msg && (
        <div className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</div>
      )}
      {err && <div className="text-xs text-rose-600 dark:text-rose-400">{err}</div>}
    </div>
  );
}
