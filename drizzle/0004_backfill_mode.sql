-- Add a per-source backfill mode (`count` | `days`). `count` keeps the
-- existing flat-extract path; `days` enables time-range backfill via
-- per-video extracts with player-client fallback (best-effort against
-- YouTube's anti-bot wall).
CREATE TYPE "public"."youtube_backfill_mode" AS ENUM('count', 'days');--> statement-breakpoint
ALTER TABLE "youtube_sources"
  ADD COLUMN "backfill_mode" "youtube_backfill_mode" DEFAULT 'count' NOT NULL;--> statement-breakpoint
ALTER TABLE "youtube_sources"
  ADD COLUMN "backfill_days" integer DEFAULT 180 NOT NULL;
