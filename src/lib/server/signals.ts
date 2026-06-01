"use server";

/**
 * Aggregations on top of the LLM-extracted insights. Two responsibilities:
 *
 *   1. `getTopSignals(filter)` — leaderboard of items the YouTube creators
 *      are talking about in the chosen time window, grouped by matched-item
 *      (or raw name when no match), with sentiment skew and a derived
 *      BUY / SELL / WATCH label.
 *
 *   2. `listChannelOptions()` — set of channels currently producing
 *      insights, for the filter-bar channel picker.
 *
 * The label thresholds match the "conservative" mode the user chose:
 *
 *   STRONG_BUY  → ≥ 3 sources, net sentiment ≥ +0.6
 *   WATCH_BULL  → ≥ 2 sources, net sentiment ≥ +0.3
 *   WATCH_BEAR  → ≥ 2 sources, net sentiment ≤ −0.3
 *   STRONG_SELL → ≥ 3 sources, net sentiment ≤ −0.6
 *   (otherwise: no label, just raw counts)
 *
 * Net sentiment = (bullish - bearish) / max(total_mentions, 1).
 */

import { inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  items,
  transactions,
  youtubeInsightMentions,
  youtubeInsights,
  youtubeVideos,
  type Transaction,
} from "@/db/schema";
import { computeHoldings } from "@/lib/calc/holdings";
import type { SignalLabel } from "@/lib/signals-shared";

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export type SignalFilter = {
  /** Time window in days (counts videos by published_at; falls back to
   * discovered_at for backfilled rows). 0 means "all time". */
  days: number;
  /** Minimum mentions required to appear on the leaderboard. */
  minMentions?: number;
  /** Optional channel filter — channel IDs to *include* (others excluded). */
  channelIds?: string[];
};

export type Signal = {
  /** Stable key for React + URL: either the items.id or `raw:<rawName>`. */
  key: string;
  /** Matched item id, or null for raw-name-only mentions. */
  itemId: string | null;
  displayName: string;
  /** Raw counts. `mixed` is mapped into neutral for skew math but kept. */
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  mentionCount: number;
  sourceCount: number;
  videoCount: number;
  avgConfidence: number | null;
  /** Highest published_at (or discovered_at) across this item's mentions. */
  lastMentionedAt: Date | null;
  /** Net sentiment in [-1, 1]: (bull - bear) / total. */
  netSentiment: number;
  /** Conservative label or null if thresholds not met. */
  label: SignalLabel | null;
  /** Current holdings if the rawName matched an `items` row, else null. */
  heldQty: number | null;
  /**
   * Action sentence shown next to the signal. Combines label + holdings
   * into a one-liner: "Consider buying — you hold 0", "Consider trimming
   * — you hold 5". Null when the label is null (no action to take).
   */
  recommendation: string | null;
};

/* ------------------------------------------------------------------ */
/* Implementation                                                      */
/* ------------------------------------------------------------------ */

type AggregateRow = {
  itemId: string | null;
  rawName: string;
  displayName: string;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  mentionCount: number;
  sourceCount: number;
  videoCount: number;
  avgConfidence: number | null;
  lastMentionedAt: Date | null;
};

/**
 * One SQL trip aggregates everything mention-side. Holdings are computed
 * separately in a second trip (we need full transactions, not just counts,
 * because of the moving-average / FIFO / lot logic).
 */
export async function getTopSignals(filter: SignalFilter): Promise<Signal[]> {
  const minMentions = Math.max(1, filter.minMentions ?? 2);
  const days = Math.max(0, Math.min(filter.days, 3650));

  // Drizzle's high-level builder gets awkward for this aggregation; raw SQL
  // is clearer and the schema is stable.
  const channelClause =
    filter.channelIds && filter.channelIds.length > 0
      ? sql`AND v.channel_id IN (${sql.join(
          filter.channelIds.map((c) => sql`${c}`),
          sql`, `,
        )})`
      : sql``;
  const dateClause =
    days > 0
      ? sql`AND COALESCE(v.published_at, v.discovered_at) > NOW() - (${days} || ' days')::interval`
      : sql``;

  const rows = await db.execute<{
    item_id: string | null;
    raw_name: string;
    display_name: string;
    bullish_count: number;
    bearish_count: number;
    neutral_count: number;
    mention_count: number;
    source_count: number;
    video_count: number;
    avg_confidence: number | null;
    last_mentioned_at: Date | null;
  }>(sql`
    SELECT
      m.item_id::text AS item_id,
      m.raw_name,
      COALESCE(it.name, m.raw_name) AS display_name,
      SUM(CASE WHEN m.sentiment = 'bullish' THEN 1 ELSE 0 END)::int AS bullish_count,
      SUM(CASE WHEN m.sentiment = 'bearish' THEN 1 ELSE 0 END)::int AS bearish_count,
      SUM(CASE WHEN m.sentiment IN ('neutral', 'mixed') THEN 1 ELSE 0 END)::int AS neutral_count,
      COUNT(*)::int AS mention_count,
      COUNT(DISTINCT v.channel_id)::int AS source_count,
      COUNT(DISTINCT v.video_id)::int AS video_count,
      AVG(m.confidence)::float AS avg_confidence,
      MAX(COALESCE(v.published_at, v.discovered_at)) AS last_mentioned_at
    FROM ${youtubeInsightMentions} m
    JOIN ${youtubeInsights} i ON i.id = m.insight_id
    JOIN ${youtubeVideos} v ON v.video_id = i.video_id
    LEFT JOIN ${items} it ON it.id = m.item_id
    WHERE 1 = 1
      ${dateClause}
      ${channelClause}
    GROUP BY m.item_id, m.raw_name, it.name
    HAVING COUNT(*) >= ${minMentions}
    ORDER BY COUNT(*) DESC, COUNT(DISTINCT v.channel_id) DESC
    LIMIT 30
  `);

  const aggregates: AggregateRow[] = rows.map((r) => ({
    itemId: r.item_id,
    rawName: r.raw_name,
    displayName: r.display_name,
    bullishCount: r.bullish_count,
    bearishCount: r.bearish_count,
    neutralCount: r.neutral_count,
    mentionCount: r.mention_count,
    sourceCount: r.source_count,
    videoCount: r.video_count,
    avgConfidence: r.avg_confidence,
    lastMentionedAt: r.last_mentioned_at,
  }));

  // Batch-fetch holdings for matched items.
  const matchedItemIds = aggregates
    .map((a) => a.itemId)
    .filter((x): x is string => x !== null);
  const holdings = await loadHoldings(matchedItemIds);

  return aggregates.map((a) => toSignal(a, holdings));
}

async function loadHoldings(
  itemIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (itemIds.length === 0) return out;
  const txs = await db
    .select()
    .from(transactions)
    .where(inArray(transactions.itemId, itemIds));

  const byItem = new Map<string, Transaction[]>();
  for (const tx of txs) {
    const list = byItem.get(tx.itemId) ?? [];
    list.push(tx);
    byItem.set(tx.itemId, list);
  }
  for (const [itemId, list] of byItem) {
    try {
      const snap = computeHoldings(
        list.map((t) => ({
          type: t.type,
          quantity: t.quantity,
          finalValueCents: t.finalValueCents,
          currency: t.currency,
          occurredAt: t.occurredAt,
          status: t.status,
          lotId: t.lotId,
          shippingCents: t.shippingCents,
        })),
      );
      out.set(itemId, snap.quantity);
    } catch {
      // MixedCurrencyError, InsufficientHoldingsError — for the signals
      // view we just want a number. Fall back to a naive sum so an item
      // with weird history doesn't disappear from the leaderboard.
      const fallback = list.reduce(
        (qty, t) => qty + (t.type === "buy" ? t.quantity : -t.quantity),
        0,
      );
      out.set(itemId, Math.max(0, fallback));
    }
  }
  return out;
}

function toSignal(
  a: AggregateRow,
  holdings: Map<string, number>,
): Signal {
  const total = a.mentionCount;
  const netSentiment =
    total > 0 ? (a.bullishCount - a.bearishCount) / total : 0;
  const label = computeLabel(netSentiment, a.sourceCount);
  const heldQty = a.itemId ? holdings.get(a.itemId) ?? 0 : null;
  return {
    key: a.itemId ?? `raw:${a.rawName}`,
    itemId: a.itemId,
    displayName: a.displayName,
    bullishCount: a.bullishCount,
    bearishCount: a.bearishCount,
    neutralCount: a.neutralCount,
    mentionCount: a.mentionCount,
    sourceCount: a.sourceCount,
    videoCount: a.videoCount,
    avgConfidence: a.avgConfidence,
    lastMentionedAt: a.lastMentionedAt,
    netSentiment,
    label,
    heldQty,
    recommendation: buildRecommendation(label, heldQty),
  };
}

/**
 * Conservative thresholds — only label items the user can act on with
 * confidence. Source diversity matters: 5 mentions from one channel is
 * one creator's opinion, not a market signal.
 */
function computeLabel(
  netSentiment: number,
  sourceCount: number,
): SignalLabel | null {
  if (sourceCount >= 3 && netSentiment >= 0.6) return "strong_buy";
  if (sourceCount >= 3 && netSentiment <= -0.6) return "strong_sell";
  if (sourceCount >= 2 && netSentiment >= 0.3) return "watch_bull";
  if (sourceCount >= 2 && netSentiment <= -0.3) return "watch_bear";
  return null;
}

function buildRecommendation(
  label: SignalLabel | null,
  heldQty: number | null,
): string | null {
  if (label === null) return null;
  const holdStr =
    heldQty === null
      ? "(no item link yet — resolve in admin)"
      : `you hold ${heldQty}`;
  switch (label) {
    case "strong_buy":
      return heldQty === 0
        ? `Consider buying — ${holdStr}`
        : `Consider adding — ${holdStr}`;
    case "watch_bull":
      return `Watching bullish — ${holdStr}`;
    case "watch_bear":
      return heldQty !== null && heldQty > 0
        ? `Consider trimming — ${holdStr}`
        : `Avoid for now — ${holdStr}`;
    case "strong_sell":
      return heldQty !== null && heldQty > 0
        ? `Consider selling — ${holdStr}`
        : `Avoid — ${holdStr}`;
  }
}

/* ------------------------------------------------------------------ */
/* Channel options for the filter bar                                  */
/* ------------------------------------------------------------------ */

export type ChannelOption = {
  channelId: string;
  channelTitle: string;
  insightCount: number;
};

/** Channels with at least one insight, ordered by recency of activity. */
export async function listChannelOptions(): Promise<ChannelOption[]> {
  const rows = await db.execute<{
    channel_id: string;
    channel_title: string | null;
    insight_count: number;
  }>(sql`
    SELECT v.channel_id,
           MAX(v.channel_title) AS channel_title,
           COUNT(i.id)::int AS insight_count
    FROM ${youtubeVideos} v
    JOIN ${youtubeInsights} i ON i.video_id = v.video_id
    GROUP BY v.channel_id
    ORDER BY MAX(i.created_at) DESC
  `);
  return rows.map((r) => ({
    channelId: r.channel_id,
    channelTitle: r.channel_title ?? r.channel_id,
    insightCount: r.insight_count,
  }));
}

