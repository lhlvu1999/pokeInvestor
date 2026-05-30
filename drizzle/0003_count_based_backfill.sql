-- Switch from date-range backfill (yt-dlp per-video, blocked by YouTube's
-- anti-bot wall) to count-based backfill (yt-dlp flat extract, reliable).
-- Drops `backfill_days`, adds `backfill_max_videos`, and makes
-- `youtube_videos.published_at` nullable since the flat extract path can't
-- read individual upload dates.
ALTER TABLE "youtube_sources" DROP COLUMN "backfill_days";--> statement-breakpoint
ALTER TABLE "youtube_sources" ADD COLUMN "backfill_max_videos" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "youtube_videos" ALTER COLUMN "published_at" DROP NOT NULL;
