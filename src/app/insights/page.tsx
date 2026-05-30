export const dynamic = "force-dynamic";

import { Card, EmptyState } from "@/components/ui";
import { listInsights } from "@/lib/server/insights";
import { getTopSignals, listChannelOptions } from "@/lib/server/signals";
import {
  DEFAULT_TIME_WINDOW_DAYS,
  SENTIMENT_OPTIONS,
} from "@/lib/signals-shared";
import type { MentionSentiment } from "@/db/schema";
import { InsightCard } from "./InsightCard";
import { InsightFilters } from "./InsightFilters";
import { TopSignals } from "./TopSignals";

type Params = {
  days?: string;
  sentiment?: string;
  channel?: string;
  q?: string;
};

function parseFilters(p: Params) {
  const days = p.days !== undefined ? Number(p.days) : DEFAULT_TIME_WINDOW_DAYS;
  const sentiments: MentionSentiment[] = (p.sentiment ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is MentionSentiment =>
      SENTIMENT_OPTIONS.includes(s as MentionSentiment),
    );
  const channelIds = (p.channel ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const q = p.q?.trim() || undefined;
  return {
    days: Number.isFinite(days) && days >= 0 ? days : DEFAULT_TIME_WINDOW_DAYS,
    sentiments,
    channelIds,
    q,
  };
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const sp = await searchParams;
  const filter = parseFilters(sp);

  // Load everything in parallel — signals + channel options + feed.
  const [signals, channels, insights] = await Promise.all([
    getTopSignals({ days: filter.days, channelIds: filter.channelIds }),
    listChannelOptions(),
    listInsights({
      days: filter.days,
      channelIds: filter.channelIds,
      overallSentiments: filter.sentiments,
      q: filter.q,
    }),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-xs text-zinc-500 mt-1">
          LLM-extracted opinions from the videos in your source list. Top
          signals aggregate across multiple creators; the feed below shows
          per-video extractions.
        </p>
      </div>

      <Card className="p-4 sm:p-5 sticky top-[6.5rem] z-[5]">
        <InsightFilters
          channels={channels}
          initial={{
            days: filter.days,
            sentiments: filter.sentiments,
            channelIds: filter.channelIds,
            q: filter.q ?? "",
          }}
        />
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-wider uppercase text-zinc-500">
          Top signals ({filter.days === 0 ? "all time" : `last ${filter.days}d`})
        </h2>
        {signals.length === 0 ? (
          <EmptyState
            title="Nothing rising to a signal yet"
            description="Items need at least 2 mentions in the window to appear. Run the pipeline (or widen the time window above) and check back."
          />
        ) : (
          <TopSignals signals={signals} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-wider uppercase text-zinc-500">
          Recent insights ({insights.length})
        </h2>
        {insights.length === 0 ? (
          <EmptyState
            title="No insights match these filters"
            description="Try a wider time window, clear the search, or remove sentiment chips."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {insights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
