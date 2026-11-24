export const dynamic = "force-dynamic";

import { Card, EmptyState } from "@/components/ui";
import { listInsights } from "@/lib/server/insights";
import { getCreatorScores } from "@/lib/server/creator_scores";
import { getDashboardData } from "@/lib/server/portfolio";
import { safe } from "@/lib/server/safe";
import { getSellCandidates } from "@/lib/server/sell_scorecard";
import { getDisplayCurrency } from "@/lib/server/settings";
import { getTopSignals, listChannelOptions } from "@/lib/server/signals";
import { getSignalTrackRecord } from "@/lib/server/signal_track";
import {
  DEFAULT_HORIZON_DAYS,
  DEFAULT_THRESHOLD,
  HORIZON_OPTIONS,
  THRESHOLD_OPTIONS,
} from "@/lib/calc/signal_track";
import {
  DEFAULT_TIME_WINDOW_DAYS,
  SENTIMENT_OPTIONS,
} from "@/lib/signals-shared";
import type { MentionSentiment } from "@/db/schema";
import { CreatorScorecard } from "./CreatorScorecard";
import { InsightCard } from "./InsightCard";
import { InsightFilters } from "./InsightFilters";
import { SellScorecard } from "./SellScorecard";
import { SignalTrackRecord } from "./SignalTrackRecord";
import { TopSignals } from "./TopSignals";

type Params = {
  days?: string;
  sentiment?: string;
  channel?: string;
  q?: string;
  horizon?: string;
  /** Hit threshold in whole percent: 2, 5 or 10. */
  move?: string;
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
  const horizonRaw = Number(sp.horizon);
  const horizon = (HORIZON_OPTIONS as readonly number[]).includes(horizonRaw)
    ? horizonRaw
    : DEFAULT_HORIZON_DAYS;
  const threshold =
    THRESHOLD_OPTIONS.find((t) => Math.round(t * 100) === Number(sp.move)) ??
    DEFAULT_THRESHOLD;
  // The page's filters without the track-record switches, so changing a
  // switch keeps them (and each switch keeps the other).
  const baseQuery = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => e[1] !== undefined),
  ).toString();

  // Load everything in parallel.
  const displayCurrency = await getDisplayCurrency();
  const [signals, channels, insights, creatorScores, dashData, track] =
    await Promise.all([
      getTopSignals({ days: filter.days, channelIds: filter.channelIds }),
      listChannelOptions(),
      listInsights({
        days: filter.days,
        channelIds: filter.channelIds,
        overallSentiments: filter.sentiments,
        q: filter.q,
      }),
      getCreatorScores({ days: filter.days, channelIds: filter.channelIds }),
      getDashboardData(displayCurrency),
      safe(
        "signal track record",
        () => getSignalTrackRecord(horizon, threshold),
        null,
      ),
    ]);
  const sellCandidates = await getSellCandidates({
    items: dashData.items,
    converted: dashData.converted,
    windowDays: filter.days === 0 ? 0 : Math.max(60, filter.days),
    limit: 10,
  });

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
          Top signals ({filter.days === 0 ? "all time" : `last ${filter.days}d`}
          )
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

      {track && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium tracking-wider uppercase text-zinc-500">
            Signal track record{" "}
            <span className="text-xs text-zinc-500 font-normal normal-case tracking-normal">
              — did creators&apos; calls turn out right?
            </span>
          </h2>
          <SignalTrackRecord
            record={track.record}
            historyFrom={track.historyFrom}
            undatedVideos={track.undatedVideos}
            horizonDays={horizon}
            baseQuery={baseQuery}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-wider uppercase text-zinc-500">
          Consider selling{" "}
          <span className="text-xs text-zinc-500 font-normal normal-case tracking-normal">
            — held items combining bearish sentiment, hold time, and portfolio
            concentration
          </span>
        </h2>
        <SellScorecard
          candidates={sellCandidates}
          currency={dashData.displayCurrency}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-wider uppercase text-zinc-500">
          Creators ({filter.days === 0 ? "all time" : `last ${filter.days}d`})
        </h2>
        <CreatorScorecard scores={creatorScores} />
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
