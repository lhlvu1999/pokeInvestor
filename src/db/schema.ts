import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  varchar,
  primaryKey,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const transactionTypeEnum = pgEnum("transaction_type", ["buy", "sell"]);
export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "received",
]);
export const priceSourceEnum = pgEnum("price_source", [
  "manual",
  "tcgplayer",
  "ebay",
  "pricecharting",
]);

/**
 * One row per distinct collectible (e.g. "Charizard 4/102 Base Set").
 * Free-text for MVP; later this can be linked to a card catalog.
 */
export const items = pgTable(
  "items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    setCode: text("set_code"),
    cardNumber: text("card_number"),
    imageUrl: text("image_url"),
    note: text("note"),
    /** Optional TCGPlayer (or any external) product URL — display-only link. */
    sourceUrl: text("source_url"),
    /** Optional PriceCharting product ID for live price fetching. */
    pricechartingId: text("pricecharting_id"),
    /**
     * Free-form lowercase tags for grouping items (e.g. "etb", "slab",
     * "booster box"). Stored as a Postgres text array. Indexed for fast
     * `tags @> ARRAY['x']` filtering.
     */
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("items_tags_idx").using("gin", t.tags)],
);

/**
 * Buy or sell transaction. Amount stored as integer in the *minor units* of
 * the transaction's currency (e.g. cents for USD, dong for VND). `finalValueCents`
 * is the total for the whole transaction (already includes any shipping/fees/taxes
 * for buys, or net of fees for sells). `currency` is an ISO 4217 code.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    type: transactionTypeEnum("type").notNull(),
    quantity: integer("quantity").notNull(),
    finalValueCents: bigint("final_value_cents", { mode: "number" }).notNull(),
    /**
     * Optional portion of finalValueCents that represents shipping. Useful for
     * analytics — does not affect cost basis (which uses finalValueCents). Null
     * means "shipping is not separately tracked".
     */
    shippingCents: bigint("shipping_cents", { mode: "number" }),
    currency: varchar("currency", { length: 3 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    note: text("note"),
    /**
     * Optional lot identifier for specific-lot accounting. Buys + sells with
     * the same lotId form an explicit lot — realized profit on the sell uses
     * the buy's actual cost rather than a moving-average. Set automatically
     * during CSV import (one lot per source row); null for manual entries
     * (which fall back to FIFO across leftover inventory).
     */
    lotId: uuid("lot_id"),
    /**
     * Fulfillment state. `pending` = paid for but not yet in hand (excluded
     * from available inventory). `received` = in hand (default; behaves like
     * existing transactions). Only meaningful for buys; sells are always
     * effectively received.
     */
    status: transactionStatusEnum("status").notNull().default("received"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("transactions_item_occurred_idx").on(t.itemId, t.occurredAt),
    index("transactions_lot_idx").on(t.lotId),
  ],
);

/**
 * Time-series of market price snapshots per item. Designed to support future
 * provider integrations (TCGPlayer, eBay). MVP only writes 'manual' rows.
 * `priceCents` is in minor units of the row's currency.
 */
export const marketPrices = pgTable(
  "market_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    source: priceSourceEnum("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("market_prices_item_fetched_idx").on(t.itemId, t.fetchedAt)],
);

/**
 * App-wide settings (single-tenant). One row per setting key.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Cached spot FX rates fetched from the public exchange-rate API.
 * Composite key (base, quote). `rate` is `quote per 1 base`.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    base: varchar("base", { length: 3 }).notNull(),
    quote: varchar("quote", { length: 3 }).notNull(),
    rate: doublePrecision("rate").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.base, t.quote] })],
);

// ─────────────────────────────────────────────────────────────────────────────
// YouTube-insights pipeline
//
// The crawl + LLM extraction code lives in `pipeline/` (Python). The Next.js
// app only reads from these tables (except `youtube_sources` and `prompts`,
// which it writes for user CRUD). See AGENTS.md / project memory for the
// "AI code stays out of `src/`" rule.
// ─────────────────────────────────────────────────────────────────────────────

export const youtubeSourceKindEnum = pgEnum("youtube_source_kind", [
  "channel",
  "video",
]);

export const youtubeTranscriptStatusEnum = pgEnum(
  "youtube_transcript_status",
  ["ok", "missing", "error"],
);

export const mentionSentimentEnum = pgEnum("mention_sentiment", [
  "bullish",
  "bearish",
  "neutral",
  "mixed",
]);

/**
 * LLM prompts, versioned and editable from the admin UI. Editing the prompt
 * in the UI inserts a new row with `version + 1` and atomically flips
 * `isActive` to the new row — old rows are never mutated, so every historical
 * insight can be traced back to the exact prompt that produced it.
 *
 * The `name` column groups versions of the same logical prompt (e.g.
 * "youtube_insight_extraction"). The partial unique index
 * `prompts_one_active_per_name` guarantees at most one active row per name.
 *
 * `responseSchema` is the JSON Schema enforced by OpenAI structured outputs.
 * `userTemplate` may reference variables the pipeline substitutes at run time
 * (e.g. `{{title}}`, `{{transcript}}`).
 */
export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    model: text("model").notNull(),
    /** Some models (e.g. o-series) reject `temperature`; nullable for those. */
    temperature: doublePrecision("temperature"),
    systemText: text("system_text").notNull(),
    userTemplate: text("user_template").notNull(),
    responseSchema: jsonb("response_schema").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Free-form identifier (e.g. user email) — display-only, no FK. */
    createdBy: text("created_by"),
  },
  (t) => [
    uniqueIndex("prompts_name_version_uq").on(t.name, t.version),
    uniqueIndex("prompts_one_active_per_name")
      .on(t.name)
      .where(sql`${t.isActive}`),
  ],
);

/**
 * User-curated list of YouTube sources to crawl. `kind = 'channel'` stores a
 * YouTube channel ID (`UCxxx…`) and the pipeline discovers recent videos via
 * the channel's public RSS feed. `kind = 'video'` pins a single video.
 *
 * `active = false` keeps history but stops further discovery — preferred over
 * deletion so existing `youtubeVideos.sourceId` links remain valid.
 */
export const youtubeSources = pgTable(
  "youtube_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: youtubeSourceKindEnum("kind").notNull(),
    /** Channel ID (`UCxxx…`) for `channel`, 11-char video ID for `video`. */
    externalId: text("external_id").notNull(),
    /** Display title (refreshed on each discovery run). */
    title: text("title"),
    /** Channel handle like `@PokeRev`, if known. Display-only. */
    handle: text("handle"),
    active: boolean("active").notNull().default(true),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastDiscoveredAt: timestamp("last_discovered_at", { withTimezone: true }),
    /**
     * Max videos to fetch when the source is first added. The pipeline uses
     * yt-dlp's *flat* channel-listing extraction (no per-video request, no
     * API key, sidesteps YouTube's anti-bot wall) to grab this many recent
     * videos in newest-first order. After backfill completes, ongoing
     * discovery falls back to the cheap RSS feed (~15 most recent only).
     *
     * Date-range backfill (e.g. "last 180 days") is not viable without auth
     * — YouTube's bot wall blocks the per-video metadata calls needed to
     * read upload dates. We trade exact date filtering for a reliable
     * count-based depth instead.
     */
    backfillMaxVideos: integer("backfill_max_videos").notNull().default(100),
    /**
     * Set the first time backfill finishes successfully. NULL means "not
     * yet backfilled" — picked up by the `backfill` phase. Re-running
     * (e.g. after raising `backfill_max_videos`) is a manual action that
     * clears this column back to NULL.
     */
    backfilledAt: timestamp("backfilled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("youtube_sources_kind_external_uq").on(t.kind, t.externalId),
    index("youtube_sources_active_idx").on(t.active),
  ],
);

/**
 * One row per discovered YouTube video. PK is the YouTube video ID so
 * re-discovery is a trivial upsert. `sourceId` is nullable to allow keeping
 * historical rows after a source is deleted (`ON DELETE SET NULL`).
 */
export const youtubeVideos = pgTable(
  "youtube_videos",
  {
    videoId: text("video_id").primaryKey(),
    sourceId: uuid("source_id").references(() => youtubeSources.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    channelId: text("channel_id").notNull(),
    channelTitle: text("channel_title"),
    /**
     * Upload timestamp from RSS. Nullable because count-based backfill via
     * yt-dlp's flat channel listing cannot read individual videos' upload
     * dates (YouTube's anti-bot wall blocks the per-video requests needed).
     * Backfilled rows have `published_at = NULL`; RSS-discovered rows have
     * accurate dates. Sort with `COALESCE(published_at, discovered_at)`.
     */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("youtube_videos_source_idx").on(t.sourceId),
    index("youtube_videos_published_idx").on(t.publishedAt),
  ],
);

/**
 * Raw transcript for a video. PK = `videoId` (1:1 with videos). `segments` is
 * the timestamped line array exactly as returned by `youtube-transcript-api`
 * (`[{ start, duration, text }]`) — kept so insights can cite timestamps.
 * `text` is the concatenated plain text for cheap LLM input.
 *
 * `status = 'missing'` means YouTube has no captions for this video; the row
 * is still written so the pipeline doesn't keep retrying.
 */
export const youtubeTranscripts = pgTable("youtube_transcripts", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => youtubeVideos.videoId, { onDelete: "cascade" }),
  language: varchar("language", { length: 16 }),
  text: text("text"),
  segments: jsonb("segments"),
  status: youtubeTranscriptStatusEnum("status").notNull(),
  errorMsg: text("error_msg"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Structured LLM output for one (video, prompt) pair. `payload` holds the
 * full validated JSON — the flattened `youtubeInsightMentions` rows are a
 * convenience for analytics but the payload is the source of truth.
 *
 * Unique on `(videoId, promptId)` so re-running the same prompt against the
 * same video is an upsert. Re-extraction with a *new* prompt version writes
 * a new row, preserving history for A/B comparison.
 *
 * `promptId` uses `ON DELETE RESTRICT` because prompt rows are append-only
 * and we never want to orphan an insight from the wording that produced it.
 */
export const youtubeInsights = pgTable(
  "youtube_insights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => youtubeVideos.videoId, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "restrict" }),
    payload: jsonb("payload").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("youtube_insights_video_prompt_uq").on(t.videoId, t.promptId),
    index("youtube_insights_video_idx").on(t.videoId),
  ],
);

/**
 * Flattened mentions extracted from an insight's payload. One row per
 * `(insight, mention)` — a single video can mention many products.
 *
 * `itemId` is best-effort: the matcher links to `items.id` when it can,
 * otherwise leaves it null and surfaces the row in the admin "unmatched
 * mentions" resolver so a human can pick (or create) the right item.
 * `ON DELETE SET NULL` so deleting an item doesn't destroy the mention.
 */
export const youtubeInsightMentions = pgTable(
  "youtube_insight_mentions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => youtubeInsights.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => items.id, {
      onDelete: "set null",
    }),
    /** Verbatim name as it appeared in the LLM output. */
    rawName: text("raw_name").notNull(),
    setHint: text("set_hint"),
    /** Free-form: "single", "sealed", "slab", "etb", "booster_box", … */
    productType: text("product_type"),
    sentiment: mentionSentimentEnum("sentiment").notNull(),
    /** Model-reported confidence, 0..1. */
    confidence: doublePrecision("confidence"),
    /** Offset in seconds into the video where the mention occurs, if known. */
    timestampSec: integer("timestamp_sec"),
    quote: text("quote"),
  },
  (t) => [
    index("youtube_insight_mentions_insight_idx").on(t.insightId),
    index("youtube_insight_mentions_item_idx").on(t.itemId),
  ],
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const itemsRelations = relations(items, ({ many }) => ({
  transactions: many(transactions),
  marketPrices: many(marketPrices),
  insightMentions: many(youtubeInsightMentions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  item: one(items, { fields: [transactions.itemId], references: [items.id] }),
}));

export const marketPricesRelations = relations(marketPrices, ({ one }) => ({
  item: one(items, { fields: [marketPrices.itemId], references: [items.id] }),
}));

export const promptsRelations = relations(prompts, ({ many }) => ({
  insights: many(youtubeInsights),
}));

export const youtubeSourcesRelations = relations(
  youtubeSources,
  ({ many }) => ({
    videos: many(youtubeVideos),
  }),
);

export const youtubeVideosRelations = relations(
  youtubeVideos,
  ({ one, many }) => ({
    source: one(youtubeSources, {
      fields: [youtubeVideos.sourceId],
      references: [youtubeSources.id],
    }),
    transcript: one(youtubeTranscripts, {
      fields: [youtubeVideos.videoId],
      references: [youtubeTranscripts.videoId],
    }),
    insights: many(youtubeInsights),
  }),
);

export const youtubeTranscriptsRelations = relations(
  youtubeTranscripts,
  ({ one }) => ({
    video: one(youtubeVideos, {
      fields: [youtubeTranscripts.videoId],
      references: [youtubeVideos.videoId],
    }),
  }),
);

export const youtubeInsightsRelations = relations(
  youtubeInsights,
  ({ one, many }) => ({
    video: one(youtubeVideos, {
      fields: [youtubeInsights.videoId],
      references: [youtubeVideos.videoId],
    }),
    prompt: one(prompts, {
      fields: [youtubeInsights.promptId],
      references: [prompts.id],
    }),
    mentions: many(youtubeInsightMentions),
  }),
);

export const youtubeInsightMentionsRelations = relations(
  youtubeInsightMentions,
  ({ one }) => ({
    insight: one(youtubeInsights, {
      fields: [youtubeInsightMentions.insightId],
      references: [youtubeInsights.id],
    }),
    item: one(items, {
      fields: [youtubeInsightMentions.itemId],
      references: [items.id],
    }),
  }),
);

// ─── Inferred types ──────────────────────────────────────────────────────────

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type MarketPrice = typeof marketPrices.$inferSelect;
export type NewMarketPrice = typeof marketPrices.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type TransactionType = (typeof transactionTypeEnum.enumValues)[number];
export type TransactionStatus =
  (typeof transactionStatusEnum.enumValues)[number];
export type PriceSource = (typeof priceSourceEnum.enumValues)[number];

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type YoutubeSource = typeof youtubeSources.$inferSelect;
export type NewYoutubeSource = typeof youtubeSources.$inferInsert;
export type YoutubeVideo = typeof youtubeVideos.$inferSelect;
export type NewYoutubeVideo = typeof youtubeVideos.$inferInsert;
export type YoutubeTranscript = typeof youtubeTranscripts.$inferSelect;
export type NewYoutubeTranscript = typeof youtubeTranscripts.$inferInsert;
export type YoutubeInsight = typeof youtubeInsights.$inferSelect;
export type NewYoutubeInsight = typeof youtubeInsights.$inferInsert;
export type YoutubeInsightMention =
  typeof youtubeInsightMentions.$inferSelect;
export type NewYoutubeInsightMention =
  typeof youtubeInsightMentions.$inferInsert;
export type YoutubeSourceKind =
  (typeof youtubeSourceKindEnum.enumValues)[number];
export type YoutubeTranscriptStatus =
  (typeof youtubeTranscriptStatusEnum.enumValues)[number];
export type MentionSentiment =
  (typeof mentionSentimentEnum.enumValues)[number];
