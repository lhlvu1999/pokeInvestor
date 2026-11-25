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
  date,
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
     * Optional override for the eBay Browse search. When null the app
     * derives a query from `name` plus a default negative-keyword list.
     *
     * The escape hatch for products whose name searches badly — graded
     * slabs in particular, where eBay returns other graders' population
     * at a tight (and therefore falsely confident) price cluster. Used
     * verbatim, so an override should carry its own negative keywords,
     * e.g. `Zekrom ex 210/193 PSA 10 -RGS -CGC -BGS`.
     */
    ebayQuery: text("ebay_query"),
    /**
     * The catalogue product this item is (TCGplayer product id), set from the
     * Catalogue → Link items screen. Null = not linked yet. Only sealed
     * products are linked, so `catalog_products.kind = 'sealed'`.
     */
    catalogProductId: bigint("catalog_product_id", {
      mode: "number",
    }).references(() => catalogProducts.productId, { onDelete: "set null" }),
    /** The person decided this item isn't in the catalogue (a slab, a promo). */
    /**
     * For a graded slab: the catalogue CARD it is a picture of, matched by card
     * number, language and name. Separate from `catalog_product_id` (a sealed
     * product) so no sealed-product analysis is affected. The daily sync keeps
     * this card's price, which is what lets a slab be compared with a raw card.
     */
    rawCardProductId: bigint("raw_card_product_id", { mode: "number" }).references(
      () => catalogProducts.productId,
      { onDelete: "set null" },
    ),
    /** The person said the matched card is wrong; do not match this slab again. */
    rawCardSkipped: boolean("raw_card_skipped").notNull().default(false),
    catalogLinkSkipped: boolean("catalog_link_skipped")
      .notNull()
      .default(false),
    /**
     * Who decided the catalogue link state. null = nobody yet, so the daily
     * sync may link a clear match; 'auto' = the sync linked it; 'manual' =
     * the person linked or skipped it; 'declined' = the person removed a
     * link. The sync only ever acts on null, so it never overrides a person.
     */
    catalogLinkSource: text("catalog_link_source"),
    /**
     * Sell target: tell me when this item's market price reaches this much
     * (minor units of `sellTargetCurrency`). Null = no target. Only held
     * items are alerted on; the pipeline's daily check compares it with the
     * newest market price in the same currency.
     */
    sellTargetCents: integer("sell_target_cents"),
    sellTargetCurrency: varchar("sell_target_currency", { length: 3 }),
    /**
     * Set when the pipeline alerted that the market price reached the target.
     * Cleared when the price falls back below it (so the next climb alerts
     * again) and whenever the target is changed.
     */
    sellTargetAlertedAt: timestamp("sell_target_alerted_at", {
      withTimezone: true,
    }),
    /**
     * Price floor: "tell me when the market price falls to or below this" (minor
     * units of `floorCurrency`). The mirror of the sell target; null = none.
     */
    floorCents: integer("floor_cents"),
    floorCurrency: varchar("floor_currency", { length: 3 }),
    /**
     * Set when the pipeline alerted that the price fell to the floor. Cleared when
     * the price climbs back above it (so the next fall alerts again) and whenever
     * the floor is changed.
     */
    floorAlertedAt: timestamp("floor_alerted_at", { withTimezone: true }),
    /**
     * Free-form lowercase tags for grouping items (e.g. "etb", "slab",
     * "booster box"). Stored as a Postgres text array. Indexed for fast
     * `tags @> ARRAY['x']` filtering.
     */
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    /**
     * Alternate names creators use for this product, stored lowercased.
     * The pipeline's matcher checks each `raw_name` against `name` first,
     * then `aliases @> ARRAY[lower(raw_name)]`. Lets the user resolve a
     * raw name once and have it auto-link on every future mention.
     */
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("items_tags_idx").using("gin", t.tags),
    index("items_aliases_idx").using("gin", t.aliases),
  ],
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
    /**
     * Why a sell removed stock: null = a normal sale; otherwise 'gifted',
     * 'lost' or 'opened' (see lib/calc/exit_reason). Always null on buys.
     * These still count in realized profit but not in sale statistics.
     */
    exitReason: text("exit_reason"),
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
 * Safety net for deleted transactions. A delete removes the row from
 * `transactions` (so no query anywhere has to know about "soft deleted"
 * rows) and keeps a JSON copy here for a while, so it can be restored from
 * History's "Recently deleted" list after the undo toast is gone.
 *
 * `id` is the original transaction id. Rows disappear with their item.
 */
export const deletedTransactions = pgTable(
  "deleted_transactions",
  {
    id: uuid("id").primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    snapshot: jsonb("snapshot").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("deleted_transactions_deleted_at_idx").on(t.deletedAt)],
);

/**
 * A picture the person uploaded for an item, shrunk in the browser first (a few
 * tens of KB). Kept apart from `items` so lists don't carry image bytes; the
 * item's `image_url` points at /api/items/:id/image. Gone when the item is.
 */
export const itemImages = pgTable("item_images", {
  itemId: uuid("item_id")
    .primaryKey()
    .references(() => items.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  /** The image bytes, base64 encoded. */
  dataBase64: text("data_base64").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
 * Exchange rates as they were on past days, for reports about past sales. One
 * row per day and currency, as "units of `quote` per 1 USD" (the base is always
 * USD; any pair is worked out through it). Past rates never change, so a row is
 * kept for good once fetched. Separate from `fx_rates`, which holds today's.
 */
export const fxHistory = pgTable(
  "fx_history",
  {
    day: date("day").notNull(),
    quote: varchar("quote", { length: 3 }).notNull(),
    rate: doublePrecision("rate").notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.quote] })],
);

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
// Catalogue (English + Japanese Pokémon sets and sealed products)
//
// Written by the Python pipeline's `catalog-sync` command from the public
// TCGCSV mirror of TCGplayer; the Next.js app only reads these tables, apart
// from `items.catalog_product_id`, which the "Link items" screen sets.
//
// Prices are TCGplayer's market price in US cents. Individual card prices are
// NOT stored: a set keeps only its total, top-10 and top-20 value per day, and
// its top-20 cards weekly. Full detail for one set is fetched live on demand.
// ─────────────────────────────────────────────────────────────────────────────

export const catalogSets = pgTable(
  "catalog_sets",
  {
    /** TCGplayer groupId. */
    groupId: bigint("group_id", { mode: "number" }).primaryKey(),
    /** TCGplayer category: 3 = Pokémon (English), 85 = Pokémon Japan. */
    categoryId: integer("category_id").notNull(),
    language: text("language").notNull(), // 'en' | 'ja'
    name: text("name").notNull(),
    abbreviation: text("abbreviation"),
    publishedOn: timestamp("published_on", {
      withTimezone: false,
      mode: "date",
    }),
    /** When this set's product list was last fetched. */
    productsSyncedAt: timestamp("products_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("catalog_sets_language_idx").on(t.language, t.publishedOn)],
);

export const catalogProducts = pgTable(
  "catalog_products",
  {
    /** TCGplayer productId. */
    productId: bigint("product_id", { mode: "number" }).primaryKey(),
    groupId: bigint("group_id", { mode: "number" })
      .notNull()
      .references(() => catalogSets.groupId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // 'sealed' | 'card'
    rarity: text("rarity"),
    cardNumber: text("card_number"),
    imageUrl: text("image_url"),
    url: text("url"),
  },
  (t) => [index("catalog_products_group_idx").on(t.groupId, t.kind)],
);

/** Daily market price of each SEALED product, in US cents. */
export const catalogPrices = pgTable(
  "catalog_prices",
  {
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => catalogProducts.productId, { onDelete: "cascade" }),
    day: timestamp("day", { withTimezone: false, mode: "date" }).notNull(),
    marketCents: integer("market_cents"),
    lowCents: integer("low_cents"),
    midCents: integer("mid_cents"),
    highCents: integer("high_cents"),
  },
  (t) => [primaryKey({ columns: [t.productId, t.day] })],
);

/**
 * Per-set daily totals. A card counts at its highest market price across its
 * printings (normal, holo, reverse…): "one of each card, best version".
 */
export const catalogSetDaily = pgTable(
  "catalog_set_daily",
  {
    groupId: bigint("group_id", { mode: "number" })
      .notNull()
      .references(() => catalogSets.groupId, { onDelete: "cascade" }),
    day: timestamp("day", { withTimezone: false, mode: "date" }).notNull(),
    cardCount: integer("card_count").notNull(),
    pricedCount: integer("priced_count").notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    top10Cents: bigint("top10_cents", { mode: "number" }).notNull(),
    top20Cents: bigint("top20_cents", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.day] })],
);

/** A set's twenty most valuable cards, snapshotted weekly. */
export const catalogSetTop = pgTable(
  "catalog_set_top",
  {
    groupId: bigint("group_id", { mode: "number" })
      .notNull()
      .references(() => catalogSets.groupId, { onDelete: "cascade" }),
    day: timestamp("day", { withTimezone: false, mode: "date" }).notNull(),
    rank: integer("rank").notNull(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => catalogProducts.productId, { onDelete: "cascade" }),
    marketCents: integer("market_cents").notNull(),
    variant: text("variant"),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.day, t.rank] })],
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

export const youtubeTranscriptStatusEnum = pgEnum("youtube_transcript_status", [
  "ok",
  "missing",
  "error",
]);

export const mentionSentimentEnum = pgEnum("mention_sentiment", [
  "bullish",
  "bearish",
  "neutral",
  "mixed",
]);

export const youtubeBackfillModeEnum = pgEnum("youtube_backfill_mode", [
  "count",
  "days",
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
     * Which depth heuristic the `backfill` phase uses for this source.
     *  - `count`: fetch the N newest videos via yt-dlp flat extraction
     *    (one HTTP per channel, no dates).
     *  - `days`: fetch newest-first via flat list, then per-video extract
     *    each (with `tv_embedded`/`android`/`mediaconnect` player-client
     *    fallback) to read `upload_date`, stopping at the cutoff. Slower
     *    and best-effort against YouTube's anti-bot wall; videos whose
     *    extract fails are skipped (can't verify the date).
     */
    backfillMode: youtubeBackfillModeEnum("backfill_mode")
      .notNull()
      .default("count"),
    /**
     * Max videos to fetch in `count` mode. Also a hard cap for `days` mode
     * so a runaway channel can't trigger thousands of per-video extracts.
     */
    backfillMaxVideos: integer("backfill_max_videos").notNull().default(100),
    /**
     * Cutoff in days for `days` mode — fetch videos uploaded within the
     * last N days. Ignored when `backfill_mode = 'count'`.
     */
    backfillDays: integer("backfill_days").notNull().default(180),
    /**
     * Set the first time backfill finishes successfully. NULL means "not
     * yet backfilled" — picked up by the `backfill` phase. Editing the
     * mode/count/days clears this to NULL so the next run re-processes
     * the source with the new settings.
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

/**
 * Watchlist: products the user wants to *buy* but hasn't yet. Turns the
 * app from rear-view (what did I buy?) into forward-looking (what am I
 * waiting for?). `itemId` is optional — a watchlist entry can exist
 * before the user has a corresponding item row (useful for products that
 * don't yet exist in inventory). When set, matcher-linked mentions in
 * insights will fire alerts and show under the "recent signals" column.
 *
 * `hitAt` is set the moment the entry is fulfilled — either the user
 * clicks "Bought" (auto-converts to a real transaction) or a real
 * market_price row crosses below the target buy price.
 */
export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Free-form product name; matches an existing item's name is optional. */
    name: text("name").notNull(),
    /** Set when the user explicitly links this entry to a known item so
     * matcher-driven signals resolve without fuzzy name matching. */
    itemId: uuid("item_id").references(() => items.id, {
      onDelete: "set null",
    }),
    /** Buy trigger. Null means "watch, no target" — still gets creator
     * signal aggregation, just no price alert. */
    targetBuyPriceCents: integer("target_buy_price_cents"),
    /** ISO 4217 for the target price. Kept even when the price is null
     * so the UI can suggest a currency when the user adds one later. */
    currency: varchar("currency", { length: 3 }).notNull(),
    note: text("note"),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Set the first time a real event fulfilled the watch — user
     * bought it, or a market_price crossed the target. Null while
     * still active. */
    hitAt: timestamp("hit_at", { withTimezone: true }),
    /** Set when the pipeline's daily check alerted that the linked item's
     * market price reached `targetBuyPriceCents`. Separate from `hitAt`
     * on purpose: `hitAt` retires the entry from the active list, whereas
     * a price alert is only a notification — the entry stays on the
     * watchlist until you buy it. Cleared again when the price climbs back
     * above the target, so the next dip alerts afresh. */
    targetAlertedAt: timestamp("target_alerted_at", { withTimezone: true }),
    /** Opt-in: tell me when this product reaches the age at which earlier
     * launches of its kind have typically been at their lowest price. Needs
     * the entry linked to an item that is linked to the catalogue. */
    stageAlert: boolean("stage_alert").notNull().default(false),
    /** Set when the pipeline sent that alert; it fires once per product,
     * because a product only ever gets older. */
    stageAlertedAt: timestamp("stage_alerted_at", { withTimezone: true }),
  },
  (t) => [
    index("watchlist_items_item_idx").on(t.itemId),
    index("watchlist_items_hit_idx").on(t.hitAt),
  ],
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const itemsRelations = relations(items, ({ many }) => ({
  transactions: many(transactions),
  marketPrices: many(marketPrices),
  insightMentions: many(youtubeInsightMentions),
  watchlistEntries: many(watchlistItems),
}));

export const watchlistItemsRelations = relations(watchlistItems, ({ one }) => ({
  item: one(items, {
    fields: [watchlistItems.itemId],
    references: [items.id],
  }),
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
export type CatalogSet = typeof catalogSets.$inferSelect;
export type CatalogProduct = typeof catalogProducts.$inferSelect;
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
export type YoutubeInsightMention = typeof youtubeInsightMentions.$inferSelect;
export type NewYoutubeInsightMention =
  typeof youtubeInsightMentions.$inferInsert;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type NewWatchlistItem = typeof watchlistItems.$inferInsert;
export type YoutubeSourceKind =
  (typeof youtubeSourceKindEnum.enumValues)[number];
export type YoutubeTranscriptStatus =
  (typeof youtubeTranscriptStatusEnum.enumValues)[number];
export type MentionSentiment = (typeof mentionSentimentEnum.enumValues)[number];
export type YoutubeBackfillMode =
  (typeof youtubeBackfillModeEnum.enumValues)[number];
