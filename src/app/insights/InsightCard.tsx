"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui";
import type { MentionSentiment } from "@/db/schema";
import type {
  InsightListEntry,
  InsightListMention,
} from "@/lib/server/insights";

function sentimentColor(s: MentionSentiment): string {
  switch (s) {
    case "bullish":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "bearish":
      return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300";
    case "mixed":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
    case "neutral":
    default:
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

function SentimentChip({ s }: { s: MentionSentiment }) {
  return (
    <span
      className={`inline-flex items-center text-[11px] uppercase tracking-wider rounded px-1.5 py-0.5 ${sentimentColor(s)}`}
    >
      {s}
    </span>
  );
}

function formatHMS(sec: number | null): string | null {
  if (sec == null || sec < 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function videoUrl(videoId: string, timestampSec: number | null): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return timestampSec != null && timestampSec > 0
    ? `${base}&t=${Math.floor(timestampSec)}s`
    : base;
}

type Payload = {
  summary?: string;
  overall_sentiment?: MentionSentiment;
  time_horizon?: string | null;
  price_calls?: Array<{
    subject?: string;
    direction?: "up" | "down" | "flat";
    target?: string | null;
    rationale?: string | null;
  }>;
  notable_quotes?: Array<{ text?: string; timestamp_sec?: number | null }>;
};

function asPayload(p: unknown): Payload {
  return (p && typeof p === "object" ? (p as Payload) : {}) as Payload;
}

export function InsightCard({ insight }: { insight: InsightListEntry }) {
  const [expanded, setExpanded] = useState(false);
  const payload = asPayload(insight.payload);
  const overall = payload.overall_sentiment ?? "neutral";

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={videoUrl(insight.videoId, null)}
            target="_blank"
            rel="noreferrer"
            className="font-medium hover:underline block truncate"
          >
            {insight.videoTitle}
          </a>
          <div className="text-xs text-zinc-500 mt-0.5">
            {insight.channelTitle ?? "—"}
            {" · "}
            {insight.publishedAt.toLocaleDateString()}
            {" · prompt v"}
            {insight.promptVersion}
          </div>
        </div>
        <SentimentChip s={overall} />
      </div>

      {payload.summary && (
        <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-3 leading-relaxed">
          {payload.summary}
        </p>
      )}

      {insight.mentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {insight.mentions.map((m) => (
            <MentionPill key={m.id} m={m} videoId={insight.videoId} />
          ))}
        </div>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs text-zinc-500 hover:underline"
        type="button"
      >
        {expanded ? "Hide details" : "Show details"}
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-zinc-200/60 dark:border-zinc-800/60 flex flex-col gap-4 text-sm">
          {payload.time_horizon && (
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
                Time horizon
              </div>
              <div>{payload.time_horizon}</div>
            </div>
          )}

          {payload.price_calls && payload.price_calls.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
                Price calls
              </div>
              <ul className="flex flex-col gap-1.5">
                {payload.price_calls.map((pc, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{pc.subject}</span>{" "}
                    <span className="text-zinc-500">
                      ({pc.direction}
                      {pc.target ? ` → ${pc.target}` : ""})
                    </span>
                    {pc.rationale && (
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {pc.rationale}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {payload.notable_quotes && payload.notable_quotes.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
                Notable quotes
              </div>
              <ul className="flex flex-col gap-2">
                {payload.notable_quotes.map((q, i) => (
                  <li key={i} className="text-sm border-l-2 border-zinc-300 dark:border-zinc-700 pl-3">
                    <span className="italic">{q.text}</span>
                    {q.timestamp_sec != null && (
                      <a
                        href={videoUrl(insight.videoId, q.timestamp_sec)}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-xs text-zinc-500 hover:underline"
                      >
                        [{formatHMS(q.timestamp_sec)}]
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function MentionPill({
  m,
  videoId,
}: {
  m: InsightListMention;
  videoId: string;
}) {
  const ts = formatHMS(m.timestampSec);
  const inner = (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-md px-2 py-1 text-xs border border-zinc-200 dark:border-zinc-800 ${m.matchedItemId ? "" : "border-dashed"}`}
      title={m.quote ?? undefined}
    >
      <span className="font-medium">
        {m.matchedItemName ?? m.rawName}
      </span>
      <SentimentChip s={m.sentiment} />
      {ts && (
        <span className="text-[10px] text-zinc-500 font-mono">{ts}</span>
      )}
    </span>
  );
  if (m.matchedItemId) {
    return (
      <Link href={`/items/${m.matchedItemId}`} className="hover:underline">
        {inner}
      </Link>
    );
  }
  if (m.timestampSec != null) {
    return (
      <a href={`https://www.youtube.com/watch?v=${videoId}&t=${m.timestampSec}s`} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  }
  return inner;
}
