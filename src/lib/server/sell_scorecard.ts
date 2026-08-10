/**
 * Sell-scorecard — surfaces held items that combine two independent
 * signals: creator sentiment has turned bearish, and/or capital has been
 * tied up for a long time. No market prices required (the point).
 *
 * Score = 0.6 * bearishScore + 0.3 * holdScore + 0.1 * concentrationScore
 *
 * Each sub-score is normalized to [0, 1] across the current portfolio so
 * the composite is comparable across users of different sizes.
 *
 * Kept as a pure read (no "use server") so it isn't exposed as a
 * client-callable action.
 */

import { sql, and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  items as itemsTable,
  transactions,
  youtubeInsightMentions,
  youtubeInsights,
  youtubeVideos,
} from "@/db/schema";
import { computeHoldings } from "@/lib/calc/holdings";
import type { ConvertedItemValues } from "@/lib/calc/portfolio";
import type { ItemWithValuation } from "./items";

export type SellCandidate = {
  itemId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  inventoryCost: number;
  holdMonths: number;
  bullish: number;
  bearish: number;
  neutral: number;
  netBearish: number; // bearish - bullish
  concentrationPct: number;
  holdScore: number; // [0..1]
  bearishScore: number; // [0..1]
  concentrationScore: number; // [0..1]
  score: number; // [0..1]
};

export type SellScorecardInput = {
  items: ItemWithValuation[];
  converted: ConvertedItemValues[];
  /** Only mentions in this window count toward the bearish signal.
   * 0 = all time. */
  windowDays?: number;
  /** Return the top N candidates. */
  limit?: number;
};

/**
 * Rank held items by "sellability". Requires the dashboard's existing
 * `items` and `converted` arrays as input so we don't re-query holdings.
 */
export async function getSellCandidates(
  input: SellScorecardInput,
): Promise<SellCandidate[]> {
  const windowDays = input.windowDays ?? 60;
  const limit = input.limit ?? 10;

  const heldRows = input.items
    .map((iv, i) => ({ iv, conv: input.converted[i] }))
    .filter(({ iv }) => iv.valuation.quantity > 0);
  if (heldRows.length === 0) return [];

  const heldIds = heldRows.map(({ iv }) => iv.item.id);

  // ─── Mention counts per held item, within the window ─────────────────
  const conds = [isNotNull(youtubeInsightMentions.itemId)];
  if (windowDays > 0) {
    const since = new Date(
      Date.now() - windowDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    conds.push(
      sql`coalesce(${youtubeVideos.publishedAt}, ${youtubeVideos.discoveredAt}) >= ${since}::timestamptz`,
    );
  }
  conds.push(inArray(youtubeInsightMentions.itemId, heldIds));

  const mentionRows = await db
    .select({
      itemId: youtubeInsightMentions.itemId,
      bullish: sql<string>`count(*) filter (where ${youtubeInsightMentions.sentiment} = 'bullish')`,
      bearish: sql<string>`count(*) filter (where ${youtubeInsightMentions.sentiment} = 'bearish')`,
      neutral: sql<string>`count(*) filter (where ${youtubeInsightMentions.sentiment} = 'neutral')`,
    })
    .from(youtubeInsightMentions)
    .innerJoin(
      youtubeInsights,
      sql`${youtubeInsights.id} = ${youtubeInsightMentions.insightId}`,
    )
    .innerJoin(
      youtubeVideos,
      sql`${youtubeVideos.videoId} = ${youtubeInsights.videoId}`,
    )
    .where(and(...conds))
    .groupBy(youtubeInsightMentions.itemId);

  const mentionByItem = new Map(
    mentionRows.map((r) => [
      String(r.itemId),
      {
        bullish: Number(r.bullish),
        bearish: Number(r.bearish),
        neutral: Number(r.neutral),
      },
    ]),
  );

  // ─── First-buy timestamp per held item ────────────────────────────────
  const firstBuyRows = await db
    .select({
      itemId: transactions.itemId,
      earliest: sql<Date>`min(${transactions.occurredAt})`,
    })
    .from(transactions)
    .where(
      and(inArray(transactions.itemId, heldIds), eq(transactions.type, "buy")),
    )
    .groupBy(transactions.itemId);
  const firstBuyByItem = new Map(
    firstBuyRows.map((r) => [
      r.itemId,
      new Date(r.earliest as unknown as string),
    ]),
  );

  const now = Date.now();
  const totalPortfolioCost = heldRows.reduce(
    (s, { conv }) => s + conv.inventoryCost,
    0,
  );

  // ─── Raw signals + normalization ──────────────────────────────────────
  const draft = heldRows.map(({ iv, conv }) => {
    const mentions = mentionByItem.get(iv.item.id) ?? {
      bullish: 0,
      bearish: 0,
      neutral: 0,
    };
    const firstBuy = firstBuyByItem.get(iv.item.id);
    const holdMonths = firstBuy
      ? (now - firstBuy.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      : 0;
    const netBearish = mentions.bearish - mentions.bullish;
    const concentrationPct =
      totalPortfolioCost > 0
        ? (conv.inventoryCost / totalPortfolioCost) * 100
        : 0;
    return {
      iv,
      conv,
      mentions,
      holdMonths,
      netBearish,
      concentrationPct,
    };
  });

  const maxHoldMonths = Math.max(...draft.map((d) => d.holdMonths), 1);
  // Only positive net-bearish contributes to the sell signal; negative
  // (net-bullish) means "hold", which we surface as 0.
  const maxNetBearish = Math.max(...draft.map((d) => d.netBearish), 1);
  const maxConcentration = Math.max(...draft.map((d) => d.concentrationPct), 1);

  const scored: SellCandidate[] = draft.map((d) => {
    const holdScore = d.holdMonths / maxHoldMonths;
    const bearishScore = d.netBearish > 0 ? d.netBearish / maxNetBearish : 0;
    const concentrationScore = d.concentrationPct / maxConcentration;
    const score =
      0.6 * bearishScore + 0.3 * holdScore + 0.1 * concentrationScore;
    return {
      itemId: d.iv.item.id,
      name: d.iv.item.name,
      imageUrl: d.iv.item.imageUrl,
      quantity: d.iv.valuation.quantity,
      inventoryCost: d.conv.inventoryCost,
      holdMonths: d.holdMonths,
      bullish: d.mentions.bullish,
      bearish: d.mentions.bearish,
      neutral: d.mentions.neutral,
      netBearish: d.netBearish,
      concentrationPct: d.concentrationPct,
      holdScore,
      bearishScore,
      concentrationScore,
      score,
    };
  });

  // Only surface items where at least ONE signal is meaningful.
  return scored
    .filter((s) => s.bearishScore > 0 || s.holdMonths >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Silence unused-import warning for itemsTable — kept for future filtering.
void itemsTable;
