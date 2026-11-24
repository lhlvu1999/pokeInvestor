"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applySetTagMerge, type MergeSummary } from "@/lib/server/set_tag_actions";
import type { TagProposal } from "@/lib/calc/set_tags";

/** Tick the renames you want, then apply. Nothing changes until you click. */
export function MergeForm({
  proposals,
  addable,
}: {
  proposals: TagProposal[];
  /** Items with a known set that do not carry its tag yet. */
  addable: number;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(proposals.filter((p) => p.strong).map((p) => p.tag)),
  );
  const [alsoOthers, setAlsoOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MergeSummary | null>(null);
  const [pending, start] = useTransition();
  const strong = proposals.filter((p) => p.strong);
  const weak = proposals.filter((p) => !p.strong);

  const toggle = (t: string) =>
    setChosen((c) => {
      const n = new Set(c);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  function apply() {
    setError(null);
    setDone(null);
    const n = chosen.size;
    const ok = confirm(
      `Rename ${n} tag${n === 1 ? "" : "s"}${alsoOthers ? " and add set tags to the other linked items" : ""}? You can undo it with a backup, or by editing tags.`,
    );
    if (!ok) return;
    start(async () => {
      const res = await applySetTagMerge([...chosen], alsoOthers);
      if (!res.ok) setError(res.error);
      else {
        setDone(res.data);
        router.refresh();
      }
    });
  }

  return (
    <div>
      {proposals.length === 0 ? (
        <p className="text-sm text-zinc-500">
          None of your tags names a single set, so there is nothing to rename.
        </p>
      ) : (
        <>
          {strong.length > 0 ? (
            <Rows list={strong} chosen={chosen} toggle={toggle} pending={pending} />
          ) : (
            <p className="text-sm text-zinc-500">No tag has enough evidence to suggest renaming.</p>
          )}
          {weak.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                {`${weak.length} more that need your judgment (one linked item, or they look like kinds of product)`}
              </summary>
              <div className="mt-2">
                <Rows list={weak} chosen={chosen} toggle={toggle} pending={pending} />
              </div>
            </details>
          )}
        </>
      )}

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={alsoOthers}
          onChange={(e) => setAlsoOthers(e.target.checked)}
          disabled={pending}
        />
        <span>
          Also give every other item its set&apos;s name as a tag
          <span className="block text-[11px] text-zinc-500">
            {`About ${addable} item${addable === 1 ? "" : "s"} with a known set don't carry it yet. Each gets one extra tag (never more than 12 per item).`}
          </span>
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={apply}
          disabled={pending || (chosen.size === 0 && !alsoOthers)}
          className="h-9 rounded-md px-4 text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? "Applying…" : "Apply"}
        </button>
        {done && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            {`Done: ${done.renamed} renamed, ${done.added} given a set tag`}
            {done.full > 0 ? `, ${done.full} skipped (already 12 tags)` : ""}
            {done.conflicts > 0 ? `, ${done.conflicts} left alone (edited meanwhile; apply again)` : ""}.
          </span>
        )}
        {error && <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span>}
      </div>
    </div>
  );
}

function Rows({
  list,
  chosen,
  toggle,
  pending,
}: {
  list: TagProposal[];
  chosen: Set<string>;
  toggle: (t: string) => void;
  pending: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
      {list.map((p) => (
        <li key={p.tag} className="py-2 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={chosen.has(p.tag)}
            onChange={() => toggle(p.tag)}
            aria-label={`Rename ${p.tag} to ${p.setTag}`}
            disabled={pending}
          />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{p.tag}</span>
            <span className="text-zinc-400"> → </span>
            <span className="font-medium">{p.setTag}</span>
            <span className="block text-[11px] text-zinc-500 leading-relaxed">
              {`${p.linked} linked item${p.linked === 1 ? "" : "s"} ${p.linked === 1 ? "is" : "are"} in that set`}
              {p.unlinked > 0 ? `; ${p.unlinked} not linked yet will be renamed too` : ""}
              {p.productLike ? (
                <span className="ml-1 text-amber-700 dark:text-amber-400">
                  This looks like a kind of product, not a set.
                </span>
              ) : (
                !p.strong && (
                  <span className="ml-1 text-amber-700 dark:text-amber-400">
                    Only one linked item to go on, so check it&apos;s right.
                  </span>
                )
              )}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
