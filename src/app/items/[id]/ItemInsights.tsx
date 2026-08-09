import Link from "next/link";
import type { MentionSentiment } from "@/db/schema";
import type {
  ItemMention,
  ItemInsightSummary,
} from "@/lib/server/insights";
import { Card, EmptyState } from "@/components/ui";
import { MentionActions } from "./MentionActions";

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
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function videoUrl(videoId: string, timestampSec: number | null): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return timestampSec != null && timestampSec > 0
    ? `${base}&t=${Math.floor(timestampSec)}s`
    : base;
}

function netSentimentBadge(net: number, total: number): {
  text: string;
  className: string;
} {
  if (total === 0)
    return {
      text: "no mentions",
      className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
    };
  if (net >= 0.3)
    return {
      text: `Bullish (${(net * 100).toFixed(0)}%)`,
      className:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    };
  if (net <= -0.3)
    return {
      text: `Bearish (${(net * 100).toFixed(0)}%)`,
      className:
        "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
    };
  return {
    text: `Mixed (${(net * 100).toFixed(0)}%)`,
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  };
}

export function ItemInsights({
  itemName,
  mentions,
  summary,
}: {
  itemName: string;
  mentions: ItemMention[];
  summary: ItemInsightSummary;
}) {
  if (summary.total === 0) {
    return (
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-medium">YouTube mentions</h2>
        </div>
        <EmptyState
          title="No mentions yet"
          description={`No YouTube creators in your source list have been linked to "${itemName}". Run the pipeline (or resolve unmatched mentions in /admin/mentions).`}
        />
      </Card>
    );
  }

  const badge = netSentimentBadge(summary.netSentiment, summary.total);

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-medium">YouTube mentions</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {summary.total} mention{summary.total === 1 ? "" : "s"} across{" "}
            {summary.distinctChannels} channel
            {summary.distinctChannels === 1 ? "" : "s"}
            {summary.lastMentionedAt
              ? ` · last mention ${summary.lastMentionedAt.toLocaleDateString()}`
              : ""}
          </p>
        </div>
        <span
          className={`inline-flex items-center text-[11px] uppercase tracking-wider rounded px-2 py-1 ${badge.className}`}
        >
          {badge.text}
        </span>
      </div>

      {/* Sentiment counts */}
      <div className="px-4 py-2 border-b border-zinc-200/60 dark:border-zinc-800/60 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
            {summary.bullish}
          </span>{" "}
          <span className="text-zinc-500">bullish</span>
        </span>
        <span>
          <span className="text-rose-700 dark:text-rose-400 font-medium">
            {summary.bearish}
          </span>{" "}
          <span className="text-zinc-500">bearish</span>
        </span>
        <span>
          <span className="text-amber-700 dark:text-amber-400 font-medium">
            {summary.mixed}
          </span>{" "}
          <span className="text-zinc-500">mixed</span>
        </span>
        <span>
          <span className="text-zinc-700 dark:text-zinc-300 font-medium">
            {summary.neutral}
          </span>{" "}
          <span className="text-zinc-500">neutral</span>
        </span>
        <Link
          href={`/insights?q=${encodeURIComponent(itemName)}`}
          className="ml-auto text-xs text-zinc-500 hover:underline"
        >
          View in /insights →
        </Link>
      </div>

      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {mentions.map((m) => {
          const ts = formatHMS(m.timestampSec);
          return (
            <li key={m.mentionId} className="px-4 py-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-500">
                <SentimentChip s={m.sentiment} />
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {m.channelTitle ?? "Unknown channel"}
                </span>
                <span className="text-zinc-400">·</span>
                <a
                  href={videoUrl(m.videoId, m.timestampSec)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline truncate max-w-[42ch] sm:max-w-[60ch]"
                  title={m.videoTitle}
                >
                  {m.videoTitle}
                </a>
                {ts && (
                  <span className="text-zinc-400 tabular-nums">@ {ts}</span>
                )}
                {m.videoPublishedAt && (
                  <span className="text-zinc-400 ml-auto whitespace-nowrap">
                    {m.videoPublishedAt.toLocaleDateString()}
                  </span>
                )}
              </div>
              {m.quote && (
                <blockquote className="text-sm text-zinc-700 dark:text-zinc-200 border-l-2 border-zinc-300 dark:border-zinc-700 pl-2 leading-relaxed">
                  “{m.quote}”
                </blockquote>
              )}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                {m.rawName &&
                m.rawName.toLowerCase() !== itemName.toLowerCase() ? (
                  <div className="text-[11px] text-zinc-500">
                    Said as: <span className="italic">{m.rawName}</span>
                  </div>
                ) : (
                  <span />
                )}
                <div className="ml-auto">
                  <MentionActions
                    mentionId={m.mentionId}
                    rawName={m.rawName}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
