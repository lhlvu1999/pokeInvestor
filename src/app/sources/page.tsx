export const dynamic = "force-dynamic";

import { EmptyState } from "@/components/ui";
import { listYoutubeSources } from "@/lib/server/youtube";
import {
  getPipelineHealth,
  getYoutubeSourceStats,
  type YoutubeSourceStats,
} from "@/lib/server/youtube_stats";
import { SourcesPanel } from "./SourcesPanel";

export default async function SourcesPage() {
  const [sources, statsMap, health] = await Promise.all([
    listYoutubeSources(),
    getYoutubeSourceStats(),
    getPipelineHealth(),
  ]);
  const activeCount = sources.filter((s) => s.active).length;
  const pausedCount = sources.length - activeCount;
  const statsById: Record<string, YoutubeSourceStats> = {};
  for (const [k, v] of statsMap) statsById[k] = v;

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">YouTube sources</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Channels and individual videos the insight pipeline will crawl.
            Pausing keeps history but stops new fetches.
          </p>
        </div>
        {sources.length > 0 && (
          <div className="text-xs text-zinc-500 whitespace-nowrap">
            {activeCount} active
            {pausedCount > 0 ? ` · ${pausedCount} paused` : ""}
          </div>
        )}
      </div>

      {sources.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <HealthTile label="Videos" value={health.totalVideos} tone="info" />
          <HealthTile
            label="Transcript pending"
            value={health.totalTranscriptPending}
            tone={health.totalTranscriptPending > 0 ? "warn" : "muted"}
          />
          <HealthTile
            label="Transcript errors"
            value={health.totalTranscriptError}
            tone={health.totalTranscriptError > 0 ? "danger" : "muted"}
          />
          <HealthTile
            label="Insight pending"
            value={health.totalInsightPending}
            tone={health.totalInsightPending > 0 ? "warn" : "muted"}
          />
          <HealthTile
            label="Insights"
            value={health.totalInsights}
            tone="success"
          />
        </div>
      )}

      {sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          description="Add a YouTube channel below to start crawling."
        />
      ) : null}

      <SourcesPanel sources={sources} statsById={statsById} />
    </div>
  );
}

function HealthTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "info" | "success" | "warn" | "danger" | "muted";
}) {
  const toneClass = {
    info: "border-zinc-200 dark:border-zinc-800",
    success:
      "border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300",
    warn: "border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300",
    danger:
      "border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-300",
    muted: "border-zinc-200 dark:border-zinc-800 text-zinc-500",
  }[tone];
  return (
    <div className={`rounded border ${toneClass} p-3`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
