"use server";

/**
 * Watchlist — server actions + list loader with signal joins.
 *
 * A watchlist entry either points at a known item (`item_id`) or floats
 * as a free-form name until the user links or creates it. Signal counts
 * (bullish / bearish mentions in the last 30d) are joined per-entry so
 * the UI can highlight "creators just turned bullish on this" in one
 * glance.
 */

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, pgClient } from "@/db/client";
import { items, watchlistItems, type WatchlistItem } from "@/db/schema";
import { isSupportedCurrency, parseAmountLoose } from "@/lib/currency";
import type { ActionResult } from "./items";

const SIGNAL_WINDOW_DAYS = 30;

const addSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  itemId: z.string().uuid().optional().or(z.literal("")),
  /** Buy trigger in major units as a string ("2m", "12.5"). Optional. */
  targetBuyPrice: z.string().trim().optional().or(z.literal("")),
  currency: z.string().length(3),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type AddWatchlistInput = z.input<typeof addSchema>;

export type WatchlistRow = {
  entry: WatchlistItem;
  /** Non-null when `itemId` was set. */
  linkedItemName: string | null;
  /** Bullish/bearish counts within SIGNAL_WINDOW_DAYS. Matches by
   * `item_id` when the entry is linked; otherwise fuzzy-matches by
   * lower-cased raw_name. */
  bullish: number;
  bearish: number;
  neutral: number;
  lastMentionedAt: Date | null;
};

function nullable(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  return v.length > 0 ? v : null;
}

export async function addWatchlistItem(
  input: AddWatchlistInput,
): Promise<ActionResult<WatchlistItem>> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const currency = parsed.data.currency.toUpperCase();
  if (!isSupportedCurrency(currency)) {
    return { ok: false, error: `Unsupported currency: ${currency}` };
  }

  let targetCents: number | null = null;
  if (parsed.data.targetBuyPrice && parsed.data.targetBuyPrice.trim() !== "") {
    try {
      targetCents = parseAmountLoose(parsed.data.targetBuyPrice, currency);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid target price",
      };
    }
    if (targetCents <= 0) {
      return { ok: false, error: "Target price must be positive." };
    }
  }

  const [created] = await db
    .insert(watchlistItems)
    .values({
      name: parsed.data.name,
      itemId: nullable(parsed.data.itemId),
      targetBuyPriceCents: targetCents,
      currency,
      note: nullable(parsed.data.note),
    })
    .returning();

  revalidatePath("/watchlist");
  revalidatePath("/");
  return { ok: true, data: created };
}

export async function removeWatchlistItem(
  id: string,
): Promise<ActionResult<WatchlistItem>> {
  const [existing] = await db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.id, id))
    .limit(1);
  if (!existing) return { ok: false, error: "Not found" };
  await db.delete(watchlistItems).where(eq(watchlistItems.id, id));
  revalidatePath("/watchlist");
  return { ok: true, data: existing };
}

/** Restore for the toast undo path. */
export async function restoreWatchlistItem(
  entry: WatchlistItem,
): Promise<ActionResult<WatchlistItem>> {
  try {
    await db.insert(watchlistItems).values(entry);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? `Could not restore: ${err.message}` : "Failed",
    };
  }
  revalidatePath("/watchlist");
  return { ok: true, data: entry };
}

/** Mark a watchlist entry as fulfilled without deleting it. Preserves
 * the history so the user can look back at "what did I actually buy off
 * my watchlist last quarter". */
export async function markWatchlistHit(
  id: string,
): Promise<ActionResult<null>> {
  const [existing] = await db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.id, id))
    .limit(1);
  if (!existing) return { ok: false, error: "Not found" };
  await db
    .update(watchlistItems)
    .set({ hitAt: new Date() })
    .where(eq(watchlistItems.id, id));
  revalidatePath("/watchlist");
  return { ok: true, data: null };
}

/**
 * List active watchlist entries (hit_at null) with joined signal
 * aggregates. One SQL round-trip via `db.execute` — Drizzle's ORM path
 * would need N+1 for the sentiment counts.
 */
export async function listWatchlist(): Promise<WatchlistRow[]> {
  const since = new Date(
    Date.now() - SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = await pgClient.unsafe<
    Array<{
      id: string;
      name: string;
      item_id: string | null;
      target_buy_price_cents: number | null;
      currency: string;
      note: string | null;
      added_at: Date;
      hit_at: Date | null;
      linked_item_name: string | null;
      bullish: string;
      bearish: string;
      neutral: string;
      last_mentioned_at: Date | null;
    }>
  >(
    `
    WITH mention_agg AS (
      SELECT
        w.id AS watchlist_id,
        COUNT(*) FILTER (WHERE m.sentiment = 'bullish')::int AS bullish,
        COUNT(*) FILTER (WHERE m.sentiment = 'bearish')::int AS bearish,
        COUNT(*) FILTER (WHERE m.sentiment IN ('neutral', 'mixed'))::int AS neutral,
        MAX(COALESCE(v.published_at, v.discovered_at)) AS last_mentioned_at
      FROM watchlist_items w
      LEFT JOIN youtube_insight_mentions m
        ON (
          -- Linked entries match on item_id (exact).
          (w.item_id IS NOT NULL AND m.item_id = w.item_id)
          OR
          -- Floating entries fuzzy-match on lower(raw_name).
          (w.item_id IS NULL AND lower(m.raw_name) = lower(w.name))
        )
      LEFT JOIN youtube_insights i ON i.id = m.insight_id
      LEFT JOIN youtube_videos v ON v.video_id = i.video_id
      WHERE w.hit_at IS NULL
        AND (m.id IS NULL
             OR COALESCE(v.published_at, v.discovered_at) >= $1)
      GROUP BY w.id
    )
    SELECT
      w.id, w.name, w.item_id::text AS item_id,
      w.target_buy_price_cents, w.currency, w.note, w.added_at, w.hit_at,
      it.name AS linked_item_name,
      COALESCE(a.bullish, 0)::text AS bullish,
      COALESCE(a.bearish, 0)::text AS bearish,
      COALESCE(a.neutral, 0)::text AS neutral,
      a.last_mentioned_at
    FROM watchlist_items w
    LEFT JOIN items it ON it.id = w.item_id
    LEFT JOIN mention_agg a ON a.watchlist_id = w.id
    WHERE w.hit_at IS NULL
    ORDER BY w.added_at DESC
    `,
    [since],
  );

  return rows.map((r) => ({
    entry: {
      id: r.id,
      name: r.name,
      itemId: r.item_id,
      targetBuyPriceCents: r.target_buy_price_cents,
      currency: r.currency,
      note: r.note,
      addedAt: new Date(r.added_at),
      hitAt: r.hit_at ? new Date(r.hit_at) : null,
    },
    linkedItemName: r.linked_item_name,
    bullish: Number(r.bullish),
    bearish: Number(r.bearish),
    neutral: Number(r.neutral),
    lastMentionedAt: r.last_mentioned_at ? new Date(r.last_mentioned_at) : null,
  }));
}

// Silence unused-import warnings for imports kept in case future actions land.
void and;
void desc;
void isNull;
void sql;
void items;
