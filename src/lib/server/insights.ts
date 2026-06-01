"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  items,
  prompts,
  youtubeInsightMentions,
  youtubeInsights,
  youtubeVideos,
  type MentionSentiment,
} from "@/db/schema";
import type { ActionResult } from "./items";

/* ------------------------------------------------------------------ */
/* Insight list (read-only)                                            */
/* ------------------------------------------------------------------ */

export type InsightListMention = {
  id: string;
  rawName: string;
  sentiment: MentionSentiment;
  confidence: number | null;
  productType: string | null;
  setHint: string | null;
  quote: string | null;
  timestampSec: number | null;
  matchedItemId: string | null;
  matchedItemName: string | null;
};

export type InsightListEntry = {
  id: string;
  videoId: string;
  videoTitle: string;
  channelTitle: string | null;
  /** NULL for videos discovered via backfill (count-based flat extraction
   * doesn't expose upload dates). RSS-discovered videos always have a value. */
  publishedAt: Date | null;
  createdAt: Date;
  promptVersion: number;
  payload: unknown;
  mentions: InsightListMention[];
};

export type InsightListFilter = {
  /** Time window in days (`0` = all time). Applied to the video's
   * published_at, falling back to discovered_at for backfilled rows. */
  days?: number;
  /** Restrict to insights from these channel IDs (empty = all channels). */
  channelIds?: string[];
  /**
   * Restrict to insights mentioning a string. Matches against
   * `youtube_insight_mentions.raw_name` and `items.name`, case-insensitive.
   * Use null/empty to skip.
   */
  q?: string;
  /** Restrict to insights whose overall sentiment is in this set. */
  overallSentiments?: string[];
};

/**
 * Recent insights, newest extraction first, with their mentions inlined.
 * Implemented as two queries + an in-memory join — there's only ~25–50
 * insights on a page so this is cheaper than a single mega-query and
 * easier to read.
 */
export async function listInsights(
  filter: InsightListFilter = {},
  limit = 50,
): Promise<InsightListEntry[]> {
  // Build the WHERE clause incrementally so the un-filtered call stays the
  // simple SELECT it was before.
  const conds = [] as ReturnType<typeof sql>[];
  const days = Math.max(0, Math.min(filter.days ?? 0, 3650));
  if (days > 0) {
    conds.push(sql`COALESCE(${youtubeVideos.publishedAt}, ${youtubeVideos.discoveredAt}) > NOW() - (${days} || ' days')::interval`);
  }
  if (filter.channelIds && filter.channelIds.length > 0) {
    conds.push(inArray(youtubeVideos.channelId, filter.channelIds));
  }
  const q = filter.q?.trim();
  if (q && q.length > 0) {
    // EXISTS clause across both raw_name and matched item name.
    conds.push(sql`EXISTS (
      SELECT 1
      FROM ${youtubeInsightMentions} mm
      LEFT JOIN ${items} ii ON ii.id = mm.item_id
      WHERE mm.insight_id = ${youtubeInsights.id}
        AND (mm.raw_name ILIKE ${`%${q}%`} OR ii.name ILIKE ${`%${q}%`})
    )`);
  }
  if (filter.overallSentiments && filter.overallSentiments.length > 0) {
    // overall_sentiment lives in the jsonb payload. Build an explicit
    // ARRAY[…]::text[] literal so Drizzle binds one parameter per value
    // — the older `= ANY(${arr}::text[])` form produces a record literal
    // and Postgres can't cast that.
    const valuesSql = sql.join(
      filter.overallSentiments.map((s) => sql`${s}`),
      sql`, `,
    );
    conds.push(
      sql`${youtubeInsights.payload}->>'overall_sentiment' IN (${valuesSql})`,
    );
  }
  const where = conds.length > 0 ? sql.join(conds, sql` AND `) : undefined;

  const baseQuery = db
    .select({
      id: youtubeInsights.id,
      videoId: youtubeInsights.videoId,
      videoTitle: youtubeVideos.title,
      channelTitle: youtubeVideos.channelTitle,
      publishedAt: youtubeVideos.publishedAt,
      createdAt: youtubeInsights.createdAt,
      promptVersion: prompts.version,
      payload: youtubeInsights.payload,
    })
    .from(youtubeInsights)
    .innerJoin(youtubeVideos, eq(youtubeVideos.videoId, youtubeInsights.videoId))
    .innerJoin(prompts, eq(prompts.id, youtubeInsights.promptId));
  const rows = await (where ? baseQuery.where(where) : baseQuery)
    .orderBy(desc(youtubeInsights.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const insightIds = rows.map((r) => r.id);
  const mentions = await db
    .select({
      id: youtubeInsightMentions.id,
      insightId: youtubeInsightMentions.insightId,
      rawName: youtubeInsightMentions.rawName,
      sentiment: youtubeInsightMentions.sentiment,
      confidence: youtubeInsightMentions.confidence,
      productType: youtubeInsightMentions.productType,
      setHint: youtubeInsightMentions.setHint,
      quote: youtubeInsightMentions.quote,
      timestampSec: youtubeInsightMentions.timestampSec,
      matchedItemId: youtubeInsightMentions.itemId,
      matchedItemName: items.name,
    })
    .from(youtubeInsightMentions)
    .leftJoin(items, eq(items.id, youtubeInsightMentions.itemId))
    .where(inArray(youtubeInsightMentions.insightId, insightIds));

  const byInsight = new Map<string, InsightListMention[]>();
  for (const m of mentions) {
    const list = byInsight.get(m.insightId) ?? [];
    list.push({
      id: m.id,
      rawName: m.rawName,
      sentiment: m.sentiment,
      confidence: m.confidence,
      productType: m.productType,
      setHint: m.setHint,
      quote: m.quote,
      timestampSec: m.timestampSec,
      matchedItemId: m.matchedItemId,
      matchedItemName: m.matchedItemName,
    });
    byInsight.set(m.insightId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    videoId: r.videoId,
    videoTitle: r.videoTitle,
    channelTitle: r.channelTitle,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
    promptVersion: r.promptVersion,
    payload: r.payload,
    mentions: byInsight.get(r.id) ?? [],
  }));
}

/* ------------------------------------------------------------------ */
/* Unmatched-mentions resolver                                         */
/* ------------------------------------------------------------------ */

export type UnmatchedGroup = {
  rawName: string;
  count: number;
  /** Most common sentiment for this rawName, for display only. */
  topSentiment: MentionSentiment;
};

/**
 * Mentions where the matcher couldn't link to an item. Grouped by `rawName`
 * because the same product typically appears under one spelling — resolving
 * the group resolves every row.
 */
export async function listUnmatchedMentions(
  limit = 50,
): Promise<UnmatchedGroup[]> {
  // Cheaper to count + pick a representative sentiment in SQL than to load
  // every row and group client-side.
  const rows = await db
    .select({
      rawName: youtubeInsightMentions.rawName,
      count: sql<number>`COUNT(*)::int`,
      topSentiment: sql<MentionSentiment>`
        MODE() WITHIN GROUP (ORDER BY ${youtubeInsightMentions.sentiment})
      `,
    })
    .from(youtubeInsightMentions)
    .where(isNull(youtubeInsightMentions.itemId))
    .groupBy(youtubeInsightMentions.rawName)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(limit);
  return rows;
}

export type ItemPick = {
  id: string;
  name: string;
  setCode: string | null;
};

export async function searchItemsForLink(query: string): Promise<ItemPick[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  return db
    .select({ id: items.id, name: items.name, setCode: items.setCode })
    .from(items)
    .where(ilike(items.name, `%${q}%`))
    .orderBy(items.name)
    .limit(10);
}

const linkSchema = z.object({
  rawName: z.string().trim().min(1),
  itemId: z.string().uuid(),
});

/**
 * Link every unmatched mention with the given `rawName` to an existing item.
 * Returns how many rows were updated so the UI can confirm.
 */
export async function linkMentionsByRawName(
  raw: z.input<typeof linkSchema>,
): Promise<ActionResult<{ updated: number }>> {
  const parsed = linkSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Make sure the item exists — Drizzle's update wouldn't error if it didn't.
  const item = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.id, parsed.data.itemId))
    .limit(1);
  if (!item[0]) {
    return { ok: false, error: "Item not found." };
  }

  const result = await db
    .update(youtubeInsightMentions)
    .set({ itemId: parsed.data.itemId })
    .where(
      and(
        eq(youtubeInsightMentions.rawName, parsed.data.rawName),
        isNull(youtubeInsightMentions.itemId),
      ),
    )
    .returning({ id: youtubeInsightMentions.id });

  revalidatePath("/admin/mentions");
  revalidatePath("/insights");
  return { ok: true, data: { updated: result.length } };
}

const createSchema = z.object({
  rawName: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
});

/**
 * Create a brand-new item from an unmatched rawName and link every
 * unmatched mention to it. Useful when the speaker mentioned a product
 * the user hasn't logged a transaction for yet.
 */
export async function createItemAndLinkMentions(
  raw: z.input<typeof createSchema>,
): Promise<ActionResult<{ itemId: string; updated: number }>> {
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const created = await db.transaction(async (tx) => {
    const [item] = await tx
      .insert(items)
      .values({ name: parsed.data.name })
      .returning({ id: items.id });
    const updated = await tx
      .update(youtubeInsightMentions)
      .set({ itemId: item.id })
      .where(
        and(
          eq(youtubeInsightMentions.rawName, parsed.data.rawName),
          isNull(youtubeInsightMentions.itemId),
        ),
      )
      .returning({ id: youtubeInsightMentions.id });
    return { itemId: item.id, updated: updated.length };
  });

  revalidatePath("/admin/mentions");
  revalidatePath("/insights");
  revalidatePath("/items");
  return { ok: true, data: created };
}
