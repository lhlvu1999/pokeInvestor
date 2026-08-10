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
  /** When true, also push the rawName onto items.aliases for future auto-matching. */
  rememberAlias: z.boolean().optional(),
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

  return db.transaction(async (tx) => {
    // Make sure the item exists.
    const [existing] = await tx
      .select({ id: items.id, name: items.name, aliases: items.aliases })
      .from(items)
      .where(eq(items.id, parsed.data.itemId))
      .limit(1);
    if (!existing) {
      return { ok: false as const, error: "Item not found." };
    }

    const result = await tx
      .update(youtubeInsightMentions)
      .set({ itemId: parsed.data.itemId })
      .where(
        and(
          eq(youtubeInsightMentions.rawName, parsed.data.rawName),
          isNull(youtubeInsightMentions.itemId),
        ),
      )
      .returning({ id: youtubeInsightMentions.id });

    // Optionally remember the raw name so the matcher catches the next one.
    if (parsed.data.rememberAlias) {
      const alias = parsed.data.rawName.trim().toLowerCase().replace(/\s+/g, " ");
      const canonical = existing.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (
        alias.length > 0 &&
        alias.length <= 120 &&
        alias !== canonical &&
        !existing.aliases.includes(alias) &&
        existing.aliases.length < 30
      ) {
        await tx
          .update(items)
          .set({ aliases: [...existing.aliases, alias] })
          .where(eq(items.id, parsed.data.itemId));
      }
    }

    revalidatePath("/admin/mentions");
    revalidatePath("/insights");
    revalidatePath(`/items/${parsed.data.itemId}`);
    return { ok: true as const, data: { updated: result.length } };
  });
}

const createSchema = z.object({
  rawName: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  /** When true, add the rawName as an alias on the new item. */
  rememberAlias: z.boolean().optional(),
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
    const alias =
      parsed.data.rememberAlias
        ? parsed.data.rawName.trim().toLowerCase().replace(/\s+/g, " ")
        : null;
    const canonical = parsed.data.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const initialAliases =
      alias && alias.length > 0 && alias !== canonical && alias.length <= 120
        ? [alias]
        : [];
    const [item] = await tx
      .insert(items)
      .values({ name: parsed.data.name, aliases: initialAliases })
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

/* ------------------------------------------------------------------ */
/* Per-item insights (rendered on /items/[id])                         */
/* ------------------------------------------------------------------ */

export type ItemMention = {
  mentionId: string;
  rawName: string;
  sentiment: MentionSentiment;
  confidence: number | null;
  productType: string | null;
  quote: string | null;
  timestampSec: number | null;
  insightId: string;
  insightCreatedAt: Date;
  videoId: string;
  videoTitle: string;
  videoPublishedAt: Date | null;
  channelTitle: string | null;
  channelId: string;
};

/**
 * Mentions that the matcher (or a human, via /admin/mentions) linked to a
 * specific item. Most-recent-video first. Capped to `limit` to keep the
 * item detail page snappy — for the full picture the user can drill into
 * /insights with the item name pre-filtered.
 */
export async function listMentionsForItem(
  itemId: string,
  opts: { limit?: number } = {},
): Promise<ItemMention[]> {
  const limit = opts.limit ?? 20;
  const rows = await db
    .select({
      mentionId: youtubeInsightMentions.id,
      rawName: youtubeInsightMentions.rawName,
      sentiment: youtubeInsightMentions.sentiment,
      confidence: youtubeInsightMentions.confidence,
      productType: youtubeInsightMentions.productType,
      quote: youtubeInsightMentions.quote,
      timestampSec: youtubeInsightMentions.timestampSec,
      insightId: youtubeInsights.id,
      insightCreatedAt: youtubeInsights.createdAt,
      videoId: youtubeVideos.videoId,
      videoTitle: youtubeVideos.title,
      videoPublishedAt: youtubeVideos.publishedAt,
      channelTitle: youtubeVideos.channelTitle,
      channelId: youtubeVideos.channelId,
    })
    .from(youtubeInsightMentions)
    .innerJoin(
      youtubeInsights,
      eq(youtubeInsightMentions.insightId, youtubeInsights.id),
    )
    .innerJoin(
      youtubeVideos,
      eq(youtubeInsights.videoId, youtubeVideos.videoId),
    )
    .where(eq(youtubeInsightMentions.itemId, itemId))
    // Sort by published_at when available, fall back to insight createdAt.
    .orderBy(
      desc(sql`COALESCE(${youtubeVideos.publishedAt}, ${youtubeInsights.createdAt})`),
    )
    .limit(limit);
  return rows;
}

export type ItemInsightSummary = {
  total: number;
  bullish: number;
  bearish: number;
  neutral: number;
  mixed: number;
  /** (bullish − bearish) / max(total, 1), range [-1, 1]. */
  netSentiment: number;
  /** Earliest publish/create time across the item's mentions, for "first heard". */
  firstMentionedAt: Date | null;
  /** Latest publish/create time. */
  lastMentionedAt: Date | null;
  /** Distinct channels that have mentioned the item. */
  distinctChannels: number;
};

/**
 * Aggregate stats across every mention linked to this item. Used for the
 * little summary header above the mention list on the item detail page.
 */
/**
 * Coerce a value that's typed as Date but may actually be an ISO string
 * coming back from a raw `sql<Date | null>` aggregate. Drizzle doesn't
 * auto-parse timestamps inside raw SQL templates — only column-derived
 * selections get the date hydrator.
 */
function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  return null;
}

export async function getItemInsightSummary(
  itemId: string,
): Promise<ItemInsightSummary> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      bullish: sql<number>`count(*) FILTER (WHERE ${youtubeInsightMentions.sentiment} = 'bullish')::int`,
      bearish: sql<number>`count(*) FILTER (WHERE ${youtubeInsightMentions.sentiment} = 'bearish')::int`,
      neutral: sql<number>`count(*) FILTER (WHERE ${youtubeInsightMentions.sentiment} = 'neutral')::int`,
      mixed: sql<number>`count(*) FILTER (WHERE ${youtubeInsightMentions.sentiment} = 'mixed')::int`,
      firstMentionedAt: sql<Date | null>`min(COALESCE(${youtubeVideos.publishedAt}, ${youtubeInsights.createdAt}))`,
      lastMentionedAt: sql<Date | null>`max(COALESCE(${youtubeVideos.publishedAt}, ${youtubeInsights.createdAt}))`,
      distinctChannels: sql<number>`count(DISTINCT ${youtubeVideos.channelId})::int`,
    })
    .from(youtubeInsightMentions)
    .innerJoin(
      youtubeInsights,
      eq(youtubeInsightMentions.insightId, youtubeInsights.id),
    )
    .innerJoin(
      youtubeVideos,
      eq(youtubeInsights.videoId, youtubeVideos.videoId),
    )
    .where(eq(youtubeInsightMentions.itemId, itemId));

  const total = row?.total ?? 0;
  return {
    total,
    bullish: row?.bullish ?? 0,
    bearish: row?.bearish ?? 0,
    neutral: row?.neutral ?? 0,
    mixed: row?.mixed ?? 0,
    netSentiment:
      total === 0 ? 0 : ((row?.bullish ?? 0) - (row?.bearish ?? 0)) / total,
    firstMentionedAt: toDate(row?.firstMentionedAt),
    lastMentionedAt: toDate(row?.lastMentionedAt),
    distinctChannels: row?.distinctChannels ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Per-mention controls (item detail panel)                            */
/* ------------------------------------------------------------------ */

/**
 * Unlink a single mention from its currently-linked item. The mention's
 * raw_name moves back into /admin/mentions as unmatched. Use when the
 * matcher (or a human) linked it to the wrong item.
 */
export async function unlinkMention(
  mentionId: string,
): Promise<ActionResult<null>> {
  const [m] = await db
    .select({ id: youtubeInsightMentions.id, itemId: youtubeInsightMentions.itemId })
    .from(youtubeInsightMentions)
    .where(eq(youtubeInsightMentions.id, mentionId))
    .limit(1);
  if (!m) return { ok: false, error: "Mention not found" };

  await db
    .update(youtubeInsightMentions)
    .set({ itemId: null })
    .where(eq(youtubeInsightMentions.id, mentionId));
  if (m.itemId) revalidatePath(`/items/${m.itemId}`);
  revalidatePath("/admin/mentions");
  revalidatePath("/insights");
  return { ok: true, data: null };
}

const relinkSchema = z.object({
  mentionId: z.string().uuid(),
  newItemId: z.string().uuid(),
  /** Push the mention's raw name onto the new item's aliases for next-time auto-match. */
  rememberAlias: z.boolean().optional(),
});

/**
 * Re-link a single mention to a different item. Optionally remember the
 * raw name as an alias on the new item so future occurrences auto-match
 * to the same place.
 */
export async function relinkMention(
  raw: z.input<typeof relinkSchema>,
): Promise<ActionResult<{ oldItemId: string | null; newItemId: string }>> {
  const parsed = relinkSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  return db.transaction(async (tx) => {
    const [mention] = await tx
      .select({
        id: youtubeInsightMentions.id,
        itemId: youtubeInsightMentions.itemId,
        rawName: youtubeInsightMentions.rawName,
      })
      .from(youtubeInsightMentions)
      .where(eq(youtubeInsightMentions.id, parsed.data.mentionId))
      .limit(1);
    if (!mention) {
      return { ok: false as const, error: "Mention not found" };
    }

    const [newItem] = await tx
      .select({
        id: items.id,
        name: items.name,
        aliases: items.aliases,
      })
      .from(items)
      .where(eq(items.id, parsed.data.newItemId))
      .limit(1);
    if (!newItem) {
      return { ok: false as const, error: "Target item not found" };
    }

    await tx
      .update(youtubeInsightMentions)
      .set({ itemId: newItem.id })
      .where(eq(youtubeInsightMentions.id, mention.id));

    if (parsed.data.rememberAlias) {
      const alias = mention.rawName.trim().toLowerCase().replace(/\s+/g, " ");
      const canonical = newItem.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (
        alias.length > 0 &&
        alias.length <= 120 &&
        alias !== canonical &&
        !newItem.aliases.includes(alias) &&
        newItem.aliases.length < 30
      ) {
        await tx
          .update(items)
          .set({ aliases: [...newItem.aliases, alias] })
          .where(eq(items.id, newItem.id));
      }
    }

    if (mention.itemId) revalidatePath(`/items/${mention.itemId}`);
    revalidatePath(`/items/${newItem.id}`);
    revalidatePath("/admin/mentions");
    revalidatePath("/insights");
    return {
      ok: true as const,
      data: { oldItemId: mention.itemId, newItemId: newItem.id },
    };
  });
}
