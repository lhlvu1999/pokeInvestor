/**
 * Loader for the Insights page's signal track record. A pure read (no "use
 * server"), so it is not exposed as a client-callable action.
 */

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  items,
  marketPrices,
  youtubeInsightMentions,
  youtubeInsights,
  youtubeVideos,
} from "@/db/schema";
import type { PricePoint } from "@/lib/calc/price_history";
import {
  MAX_GAP_DAYS,
  buildTrackRecord,
  dedupeSignals,
  type RawMention,
  type TrackRecord,
} from "@/lib/calc/signal_track";

export type TrackRecordData = {
  record: TrackRecord;
  /** Earliest price snapshot we hold, epoch ms. Calls older than this
   * cannot be scored, and the page says so. */
  historyFrom: number | null;
  /** Calls with no usable upload date, left out entirely. */
  undatedVideos: number;
};

export async function getSignalTrackRecord(
  horizonDays: number,
  threshold: number,
  now: Date = new Date(),
): Promise<TrackRecordData> {
  // Only videos with a REAL upload time. Backfilled rows carry just the
  // time the crawler found them, which says nothing about when the call was
  // made, so scoring against it would be scoring the wrong window.
  const rows = await db
    .select({
      videoId: youtubeVideos.videoId,
      channelId: youtubeVideos.channelId,
      channelTitle: sql<string>`coalesce(${youtubeVideos.channelTitle}, '(unknown)')`,
      itemId: youtubeInsightMentions.itemId,
      itemName: items.name,
      sentiment: youtubeInsightMentions.sentiment,
      at: youtubeVideos.publishedAt,
    })
    .from(youtubeInsightMentions)
    .innerJoin(
      youtubeInsights,
      eq(youtubeInsights.id, youtubeInsightMentions.insightId),
    )
    .innerJoin(
      youtubeVideos,
      eq(youtubeVideos.videoId, youtubeInsights.videoId),
    )
    .innerJoin(items, eq(items.id, youtubeInsightMentions.itemId))
    .where(
      and(
        isNotNull(youtubeInsightMentions.itemId),
        isNotNull(youtubeVideos.publishedAt),
        inArray(youtubeInsightMentions.sentiment, ["bullish", "bearish"]),
      ),
    );

  const mentions: RawMention[] = rows.map((r) => ({
    videoId: r.videoId,
    channelId: r.channelId,
    channelTitle: r.channelTitle,
    itemId: r.itemId as string,
    itemName: r.itemName,
    sentiment: r.sentiment,
    at: r.at as Date,
  }));

  const [priceRows, undated] = await Promise.all([
    db
      .select({
        itemId: marketPrices.itemId,
        priceCents: marketPrices.priceCents,
        fetchedAt: marketPrices.fetchedAt,
      })
      .from(marketPrices),
    db
      .select({ n: sql<string>`count(distinct ${youtubeVideos.videoId})` })
      .from(youtubeVideos)
      .innerJoin(
        youtubeInsights,
        eq(youtubeInsights.videoId, youtubeVideos.videoId),
      )
      .innerJoin(
        youtubeInsightMentions,
        eq(youtubeInsightMentions.insightId, youtubeInsights.id),
      )
      .where(
        and(
          sql`${youtubeVideos.publishedAt} is null`,
          isNotNull(youtubeInsightMentions.itemId),
        ),
      ),
  ]);

  const historyByItem = new Map<string, PricePoint[]>();
  let from: number | null = null;
  for (const p of priceRows) {
    const list = historyByItem.get(p.itemId) ?? [];
    list.push({ fetchedAt: p.fetchedAt, priceCents: p.priceCents });
    historyByItem.set(p.itemId, list);
    const t = p.fetchedAt.getTime();
    if (from == null || t < from) from = t;
  }

  const record = buildTrackRecord(dedupeSignals(mentions), historyByItem, {
    horizonDays,
    threshold,
    maxGapDays: MAX_GAP_DAYS,
    now,
  });
  return {
    record,
    historyFrom: from,
    undatedVideos: Number(undated[0]?.n ?? 0),
  };
}
