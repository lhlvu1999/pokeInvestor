"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select, TextInput } from "@/components/ui";
import {
  SENTIMENT_OPTIONS,
  TIME_WINDOW_OPTIONS,
} from "@/lib/signals-shared";
import type { MentionSentiment } from "@/db/schema";
import type { ChannelOption } from "@/lib/server/signals";

type FilterState = {
  days: number;
  sentiments: MentionSentiment[];
  channelIds: string[];
  q: string;
};

/**
 * URL-param-driven filter bar. Every change writes back to the URL so the
 * filter is bookmarkable and survives a hard reload. The server page
 * re-runs its queries on each URL change.
 */
export function InsightFilters({
  channels,
  initial,
}: {
  channels: ChannelOption[];
  initial: FilterState;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  function update(next: Partial<FilterState>) {
    const merged: FilterState = { ...initial, ...next };
    const params = new URLSearchParams();
    if (merged.days !== undefined) params.set("days", String(merged.days));
    if (merged.sentiments.length > 0) {
      params.set("sentiment", merged.sentiments.join(","));
    }
    if (merged.channelIds.length > 0) {
      params.set("channel", merged.channelIds.join(","));
    }
    if (merged.q.trim().length > 0) params.set("q", merged.q.trim());
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function toggleSentiment(s: MentionSentiment) {
    const set = new Set(initial.sentiments);
    if (set.has(s)) set.delete(s);
    else set.add(s);
    update({ sentiments: Array.from(set) });
  }

  const hasFilters =
    initial.sentiments.length > 0 ||
    initial.channelIds.length > 0 ||
    initial.q.trim().length > 0 ||
    initial.days !== 30;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500 uppercase tracking-wider">Window</span>
          <Select
            value={String(initial.days)}
            onChange={(e) => update({ days: Number(e.target.value) })}
            className="h-8 text-sm"
          >
            {TIME_WINDOW_OPTIONS.map((w) => (
              <option key={w.days} value={String(w.days)}>
                {w.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500 uppercase tracking-wider">Channel</span>
          <Select
            value={initial.channelIds[0] ?? ""}
            onChange={(e) =>
              update({
                channelIds: e.target.value ? [e.target.value] : [],
              })
            }
            className="h-8 text-sm min-w-[160px]"
          >
            <option value="">All channels</option>
            {channels.map((c) => (
              <option key={c.channelId} value={c.channelId}>
                {c.channelTitle} ({c.insightCount})
              </option>
            ))}
          </Select>
        </label>

        <label className="flex items-center gap-2 text-xs flex-1 min-w-[200px]">
          <span className="text-zinc-500 uppercase tracking-wider">Search</span>
          <TextInput
            defaultValue={initial.q}
            placeholder="Card or product name…"
            className="h-8 text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                update({ q: e.currentTarget.value });
              }
            }}
            onBlur={(e) => {
              if (e.target.value !== initial.q) update({ q: e.target.value });
            }}
          />
        </label>

        {hasFilters && (
          <button
            onClick={() =>
              update({ days: 30, sentiments: [], channelIds: [], q: "" })
            }
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          Sentiment
        </span>
        {SENTIMENT_OPTIONS.map((s) => {
          const active = initial.sentiments.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleSentiment(s)}
              className={`text-[11px] uppercase tracking-wider rounded px-2 py-1 transition-colors ${
                active
                  ? sentimentActiveClass(s)
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {s}
            </button>
          );
        })}
        {initial.sentiments.length === 0 && (
          <span className="text-[11px] text-zinc-400">All</span>
        )}
      </div>
    </div>
  );
}

function sentimentActiveClass(s: MentionSentiment): string {
  switch (s) {
    case "bullish":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "bearish":
      return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300";
    case "mixed":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
    case "neutral":
      return "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200";
  }
}
