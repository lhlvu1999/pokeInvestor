/**
 * Per-channel scorecard: how much each YouTube creator is talking, how
 * often the matcher can tie their mentions to items we track, and their
 * sentiment skew. Intended to help the user quickly see which creators
 * are worth watching vs. which are producing noise.
 *
 * Kept as a pure read (no "use server") so it isn't exposed as a
 * client-callable action.
 */

import { and, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  youtubeInsightMentions,
  youtubeInsights,
  youtubeVideos,
} from "@/db/schema";

export type CreatorScore = {
  channelId: string;
  channelTitle: string;
  videos: number;
  mentions: number;
  matchedMentions: number;
  bullish: number;
  bearish: number;
  neutral: number;
  avgConfidence: number | null;
};

export type CreatorScoresFilter = {
  /** 0 = all time. Otherwise last N days by video.published_at (falls back
   * to discovered_at for backfilled rows). */
  days: number;
  /** Limit to specific channels. Empty = all. */
  channelIds?: string[];
};

/**
 * One-shot aggregate. Returns creators sorted by mention count desc.
 * Small-N enough (typical 5-50 channels) that we don't paginate.
 */
export async function getCreatorScores(
  filter: CreatorScoresFilter,
): Promise<CreatorScore[]> {
  const conditions = [];
  if (filter.days > 0) {
    const since = new Date(
      Date.now() - filter.days * 24 * 60 * 60 * 1000,
    ).toISOString();
    conditions.push(
      sql`coalesce(${youtubeVideos.publishedAt}, ${youtubeVideos.discoveredAt}) >= ${since}::timestamptz`,
    );
  }
  if (filter.channelIds && filter.channelIds.length > 0) {
    conditions.push(inArray(youtubeVideos.channelId, filter.channelIds));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      channelId: youtubeVideos.channelId,
      channelTitle: sql<string>`coalesce(${youtubeVideos.channelTitle}, '(unknown)')`,
      videos: sql<string>`count(distinct ${youtubeVideos.videoId})`,
      mentions: sql<string>`count(${youtubeInsightMentions.id})`,
      matchedMentions: sql<string>`count(${youtubeInsightMentions.itemId})`,
      bullish: sql<string>`count(*) filter (where ${youtubeInsightMentions.sentiment} = 'bullish')`,
      bearish: sql<string>`count(*) filter (where ${youtubeInsightMentions.sentiment} = 'bearish')`,
      neutral: sql<string>`count(*) filter (where ${youtubeInsightMentions.sentiment} = 'neutral')`,
      avgConfidence: sql<
        string | null
      >`avg(${youtubeInsightMentions.confidence})`,
    })
    .from(youtubeVideos)
    .innerJoin(
      youtubeInsights,
      sql`${youtubeInsights.videoId} = ${youtubeVideos.videoId}`,
    )
    .innerJoin(
      youtubeInsightMentions,
      sql`${youtubeInsightMentions.insightId} = ${youtubeInsights.id}`,
    )
    .where(where)
    .groupBy(youtubeVideos.channelId, youtubeVideos.channelTitle)
    .orderBy(sql`count(${youtubeInsightMentions.id}) desc`);

  return rows.map((r) => ({
    channelId: r.channelId,
    channelTitle: r.channelTitle,
    videos: Number(r.videos),
    mentions: Number(r.mentions),
    matchedMentions: Number(r.matchedMentions),
    bullish: Number(r.bullish),
    bearish: Number(r.bearish),
    neutral: Number(r.neutral),
    avgConfidence:
      r.avgConfidence == null || r.avgConfidence === ""
        ? null
        : Number(r.avgConfidence),
  }));
}
