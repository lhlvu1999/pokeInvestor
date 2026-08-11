/**
 * Schema hint that goes into the chat LLM's system prompt. Kept
 * hand-written (rather than auto-derived from Drizzle) because the
 * annotations — semantic notes, conventions, gotchas — matter more
 * than exhaustive column lists. A 7B model does much better with
 * short-and-well-explained than long-and-mechanical.
 */

export const SCHEMA_DOC = `
You have read-only SQL access to a Postgres database via the run_sql tool.
Write standard Postgres SQL. Prefer aggregation to fetching raw rows.

── conventions ────────────────────────────────────────────────────────────
- Money is stored in *minor units* of the row's currency
  (e.g. USD 18.50 → 1850, VND 500,000 → 500000). VND has exponent 0 so
  values are already in dong. Always report totals with the currency
  code alongside the number.
- Each item has ONE currency across all its transactions (enforced by
  MixedCurrencyError in the app). To get an item's currency, take any
  transaction's \`currency\`.
- Timestamps are all UTC with \`with time zone\`.

── tables ─────────────────────────────────────────────────────────────────

items
  id uuid, name text, set_code text, card_number text, image_url text,
  note text, source_url text, pricecharting_id text, tags text[],
  aliases text[], created_at timestamptz

transactions
  id uuid, item_id uuid → items,
  type text ('buy' | 'sell'),
  quantity integer, final_value_cents integer, currency varchar(3),
  status text ('pending' | 'received', only meaningful for buys),
  occurred_at timestamptz,
  lot_id uuid null,       -- specific-lot pair for imports; null for manual
  shipping_cents integer null,
  note text                -- user's journal entry, "why did I buy this?"

market_prices
  id uuid, item_id uuid → items,
  price_cents integer, currency varchar(3),
  source text ('manual' | 'tcgplayer' | 'ebay' | 'pricecharting'),
  fetched_at timestamptz
  -- Time-series. For "current price" pick MAX(fetched_at) per item.

youtube_sources
  id uuid, kind text ('channel' | 'video'), external_id text,
  title text, handle text, active bool,
  added_at timestamptz, last_discovered_at timestamptz,
  backfill_mode text ('count' | 'days'), backfill_max_videos integer,
  backfill_days integer, backfilled_at timestamptz

youtube_videos
  video_id text PK, source_id uuid → youtube_sources,
  title text, channel_id text, channel_title text,
  published_at timestamptz null,  -- null on backfilled rows
  duration_sec integer, discovered_at timestamptz
  -- Sort by COALESCE(published_at, discovered_at) DESC.

youtube_transcripts
  video_id text PK → youtube_videos,
  language varchar(16), text text null,
  status text ('ok' | 'missing' | 'error'), error_msg text,
  fetched_at timestamptz

youtube_insights
  id uuid, video_id text → youtube_videos, prompt_id uuid → prompts,
  payload jsonb,             -- structured LLM output
  input_tokens integer, output_tokens integer, latency_ms integer,
  created_at timestamptz

youtube_insight_mentions
  id uuid, insight_id uuid → youtube_insights,
  item_id uuid null → items,  -- null = matcher couldn't link
  raw_name text,              -- verbatim name from the LLM
  set_hint text, product_type text,
  sentiment text ('bullish' | 'neutral' | 'bearish'),
  confidence double precision null,
  timestamp_sec integer null, quote text null

watchlist_items
  id uuid, name text, item_id uuid null → items,  -- optional link
  target_buy_price_cents integer null, currency varchar(3),
  note text null,
  added_at timestamptz, hit_at timestamptz null
  -- Active entries have hit_at IS NULL. When the user buys the product
  -- or a market price crosses the target, hit_at is set (row kept for
  -- history). Match creator mentions by item_id when linked, else by
  -- lower(raw_name) = lower(w.name).

── useful patterns ────────────────────────────────────────────────────────

-- currently-held quantity per item (buys minus sells, no lot logic)
WITH deltas AS (
  SELECT item_id,
    SUM(CASE WHEN type = 'buy' THEN quantity ELSE -quantity END) AS held
  FROM transactions GROUP BY item_id
)
SELECT i.name, d.held FROM items i JOIN deltas d ON d.item_id = i.id
WHERE d.held > 0 ORDER BY d.held DESC;

-- latest market price per held item
SELECT DISTINCT ON (mp.item_id) i.name, mp.price_cents, mp.currency, mp.fetched_at
FROM market_prices mp JOIN items i ON i.id = mp.item_id
ORDER BY mp.item_id, mp.fetched_at DESC;

-- top items by bullish creator mentions in the last 30 days
SELECT i.name, COUNT(*) AS bullish_mentions
FROM youtube_insight_mentions m
JOIN items i ON i.id = m.item_id
JOIN youtube_insights ins ON ins.id = m.insight_id
JOIN youtube_videos v ON v.video_id = ins.video_id
WHERE m.sentiment = 'bullish'
  AND COALESCE(v.published_at, v.discovered_at) >= now() - interval '30 days'
GROUP BY i.name ORDER BY bullish_mentions DESC LIMIT 20;

-- watchlist entries with recent bullish signals (last 30d)
SELECT w.name,
       COUNT(*) FILTER (WHERE m.sentiment = 'bullish') AS bullish,
       COUNT(*) FILTER (WHERE m.sentiment = 'bearish') AS bearish
FROM watchlist_items w
LEFT JOIN youtube_insight_mentions m
  ON (w.item_id IS NOT NULL AND m.item_id = w.item_id)
   OR (w.item_id IS NULL AND lower(m.raw_name) = lower(w.name))
LEFT JOIN youtube_insights i ON i.id = m.insight_id
LEFT JOIN youtube_videos v ON v.video_id = i.video_id
WHERE w.hit_at IS NULL
  AND (m.id IS NULL
       OR COALESCE(v.published_at, v.discovered_at) >= now() - interval '30 days')
GROUP BY w.id, w.name
HAVING COUNT(*) FILTER (WHERE m.sentiment = 'bullish') > 0
ORDER BY bullish DESC;

── rules ──────────────────────────────────────────────────────────────────
- Only SELECT statements are allowed. The tool will reject any DDL/DML.
- Access to pg_* / information_schema is blocked.
- Results are capped at 500 rows; add LIMIT to narrow further.
- Statement timeout is 5s; use WHERE + JOINs, not full scans of large
  tables (transactions and youtube_insight_mentions are the big ones).
`.trim();
