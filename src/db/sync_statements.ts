/**
 * Every statement that brings a database up to what `src/db/schema.ts` declares,
 * on top of the original migrations in /drizzle. Each one is safe to run again
 * (IF NOT EXISTS, or a guarded block), so running them on a database that is
 * already up to date changes nothing.
 *
 * Used by the "Sync schema" button in the admin page AND by `npm run db:migrate`,
 * so a fresh install and an upgraded one end up identical. When you change
 * schema.ts, add the matching statement here; `npm run check:schema` tells you
 * if you forgot.
 */

export const SCHEMA_STATEMENTS: string[] = [
  // Enum types — guarded by exception block (no IF NOT EXISTS for CREATE TYPE).
  `DO $$ BEGIN
     CREATE TYPE transaction_status AS ENUM ('pending', 'received');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // ALTER TYPE ADD VALUE supports IF NOT EXISTS natively.
  `ALTER TYPE price_source ADD VALUE IF NOT EXISTS 'pricecharting'`,

  // items: optional metadata + tags.
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS source_url text`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS pricecharting_id text`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS ebay_query text`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[]`,
  `CREATE INDEX IF NOT EXISTS items_tags_idx ON items USING gin (tags)`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT ARRAY[]::text[]`,
  `CREATE INDEX IF NOT EXISTS items_aliases_idx ON items USING gin (aliases)`,

  // transactions: lot tracking, fulfillment status, shipping breakdown.
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS lot_id uuid`,
  `CREATE INDEX IF NOT EXISTS transactions_lot_idx ON transactions USING btree (lot_id)`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status transaction_status NOT NULL DEFAULT 'received'`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS shipping_cents bigint`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS exit_reason text`,

  // Deleted-transaction archive ("Recently deleted" on History).
  `CREATE TABLE IF NOT EXISTS deleted_transactions (
     id uuid PRIMARY KEY,
     item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
     snapshot jsonb NOT NULL,
     deleted_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS deleted_transactions_deleted_at_idx ON deleted_transactions USING btree (deleted_at)`,

  // Past exchange rates (per 1 USD), for reports about past sales.
  `CREATE TABLE IF NOT EXISTS fx_history (
     day date NOT NULL,
     quote varchar(3) NOT NULL,
     rate double precision NOT NULL,
     PRIMARY KEY (day, quote)
   )`,

  // Pictures uploaded by hand for items the catalogue has no image for.
  `CREATE TABLE IF NOT EXISTS item_images (
     item_id uuid PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
     content_type text NOT NULL,
     data_base64 text NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,

  // ── Catalogue (English + Japanese sets, sealed products, set totals) ──
  `CREATE TABLE IF NOT EXISTS catalog_sets (
     group_id bigint PRIMARY KEY,
     category_id integer NOT NULL,
     language text NOT NULL,
     name text NOT NULL,
     abbreviation text,
     published_on timestamp,
     products_synced_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS catalog_sets_language_idx ON catalog_sets USING btree (language, published_on)`,
  `CREATE TABLE IF NOT EXISTS catalog_products (
     product_id bigint PRIMARY KEY,
     group_id bigint NOT NULL REFERENCES catalog_sets(group_id) ON DELETE CASCADE,
     name text NOT NULL,
     kind text NOT NULL,
     rarity text,
     card_number text,
     image_url text,
     url text
   )`,
  `CREATE INDEX IF NOT EXISTS catalog_products_group_idx ON catalog_products USING btree (group_id, kind)`,
  `CREATE TABLE IF NOT EXISTS catalog_prices (
     product_id bigint NOT NULL REFERENCES catalog_products(product_id) ON DELETE CASCADE,
     day timestamp NOT NULL,
     market_cents integer,
     low_cents integer,
     mid_cents integer,
     high_cents integer,
     PRIMARY KEY (product_id, day)
   )`,
  `CREATE TABLE IF NOT EXISTS catalog_set_daily (
     group_id bigint NOT NULL REFERENCES catalog_sets(group_id) ON DELETE CASCADE,
     day timestamp NOT NULL,
     card_count integer NOT NULL,
     priced_count integer NOT NULL,
     total_cents bigint NOT NULL,
     top10_cents bigint NOT NULL,
     top20_cents bigint NOT NULL,
     PRIMARY KEY (group_id, day)
   )`,
  `CREATE TABLE IF NOT EXISTS catalog_set_top (
     group_id bigint NOT NULL REFERENCES catalog_sets(group_id) ON DELETE CASCADE,
     day timestamp NOT NULL,
     rank integer NOT NULL,
     product_id bigint NOT NULL REFERENCES catalog_products(product_id) ON DELETE CASCADE,
     market_cents integer NOT NULL,
     variant text,
     PRIMARY KEY (group_id, day, rank)
   )`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS catalog_product_id bigint REFERENCES catalog_products(product_id) ON DELETE SET NULL`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS catalog_link_skipped boolean NOT NULL DEFAULT false`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS catalog_link_source text`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS raw_card_product_id bigint REFERENCES catalog_products(product_id) ON DELETE SET NULL`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS raw_card_skipped boolean NOT NULL DEFAULT false`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS sell_target_cents integer`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS sell_target_currency varchar(3)`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS sell_target_alerted_at timestamptz`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS floor_cents integer`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS floor_currency varchar(3)`,
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS floor_alerted_at timestamptz`,

  // ── YouTube-insights pipeline ───────────────────────────────────────
  // Enums first; ENUM types can't run CREATE TYPE IF NOT EXISTS pre-PG10
  // so use a DO block + duplicate_object exception guard.
  `DO $$ BEGIN
     CREATE TYPE youtube_source_kind AS ENUM ('channel', 'video');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
     CREATE TYPE youtube_transcript_status AS ENUM ('ok', 'missing', 'error');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
     CREATE TYPE mention_sentiment AS ENUM ('bullish', 'bearish', 'neutral', 'mixed');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
     CREATE TYPE youtube_backfill_mode AS ENUM ('count', 'days');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // prompts (no FK)
  `CREATE TABLE IF NOT EXISTS prompts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL,
     version integer NOT NULL,
     model text NOT NULL,
     temperature double precision,
     system_text text NOT NULL,
     user_template text NOT NULL,
     response_schema jsonb NOT NULL,
     is_active boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     created_by text
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS prompts_name_version_uq ON prompts (name, version)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS prompts_one_active_per_name ON prompts (name) WHERE is_active`,

  // youtube_sources (no FK)
  `CREATE TABLE IF NOT EXISTS youtube_sources (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     kind youtube_source_kind NOT NULL,
     external_id text NOT NULL,
     title text,
     handle text,
     active boolean NOT NULL DEFAULT true,
     added_at timestamptz NOT NULL DEFAULT now(),
     last_discovered_at timestamptz,
     backfill_mode youtube_backfill_mode NOT NULL DEFAULT 'count',
     backfill_max_videos integer NOT NULL DEFAULT 100,
     backfill_days integer NOT NULL DEFAULT 180,
     backfilled_at timestamptz
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS youtube_sources_kind_external_uq ON youtube_sources (kind, external_id)`,
  `CREATE INDEX IF NOT EXISTS youtube_sources_active_idx ON youtube_sources (active)`,

  // youtube_videos (FK → youtube_sources, ON DELETE SET NULL)
  `CREATE TABLE IF NOT EXISTS youtube_videos (
     video_id text PRIMARY KEY,
     source_id uuid REFERENCES youtube_sources(id) ON DELETE SET NULL,
     title text NOT NULL,
     channel_id text NOT NULL,
     channel_title text,
     published_at timestamptz,
     duration_sec integer,
     discovered_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS youtube_videos_source_idx ON youtube_videos (source_id)`,
  `CREATE INDEX IF NOT EXISTS youtube_videos_published_idx ON youtube_videos (published_at)`,

  // youtube_transcripts (1:1 with videos, ON DELETE CASCADE)
  `CREATE TABLE IF NOT EXISTS youtube_transcripts (
     video_id text PRIMARY KEY REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
     language varchar(16),
     text text,
     segments jsonb,
     status youtube_transcript_status NOT NULL,
     error_msg text,
     fetched_at timestamptz NOT NULL DEFAULT now()
   )`,

  // youtube_insights (FK → videos CASCADE; FK → prompts RESTRICT)
  `CREATE TABLE IF NOT EXISTS youtube_insights (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     video_id text NOT NULL REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
     prompt_id uuid NOT NULL REFERENCES prompts(id) ON DELETE RESTRICT,
     payload jsonb NOT NULL,
     input_tokens integer,
     output_tokens integer,
     latency_ms integer,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS youtube_insights_video_prompt_uq ON youtube_insights (video_id, prompt_id)`,
  `CREATE INDEX IF NOT EXISTS youtube_insights_video_idx ON youtube_insights (video_id)`,

  // youtube_insight_mentions (FK → insights CASCADE; FK → items SET NULL)
  `CREATE TABLE IF NOT EXISTS youtube_insight_mentions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     insight_id uuid NOT NULL REFERENCES youtube_insights(id) ON DELETE CASCADE,
     item_id uuid REFERENCES items(id) ON DELETE SET NULL,
     raw_name text NOT NULL,
     set_hint text,
     product_type text,
     sentiment mention_sentiment NOT NULL,
     confidence double precision,
     timestamp_sec integer,
     quote text
   )`,
  `CREATE INDEX IF NOT EXISTS youtube_insight_mentions_insight_idx ON youtube_insight_mentions (insight_id)`,
  `CREATE INDEX IF NOT EXISTS youtube_insight_mentions_item_idx ON youtube_insight_mentions (item_id)`,

  // watchlist_items (FK → items SET NULL — deleting a linked item
  // keeps the watchlist entry as a free-form name)
  `CREATE TABLE IF NOT EXISTS watchlist_items (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL,
     item_id uuid REFERENCES items(id) ON DELETE SET NULL,
     target_buy_price_cents integer,
     currency varchar(3) NOT NULL,
     note text,
     added_at timestamptz NOT NULL DEFAULT now(),
     hit_at timestamptz,
     target_alerted_at timestamptz,
     stage_alert boolean NOT NULL DEFAULT false,
     stage_alerted_at timestamptz
   )`,
  // Added after the table first shipped, so existing installs need it too.
  `ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS target_alerted_at timestamptz`,
  `ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS stage_alert boolean NOT NULL DEFAULT false`,
  `ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS stage_alerted_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS watchlist_items_item_idx ON watchlist_items (item_id)`,
  `CREATE INDEX IF NOT EXISTS watchlist_items_hit_idx ON watchlist_items (hit_at)`,
];
