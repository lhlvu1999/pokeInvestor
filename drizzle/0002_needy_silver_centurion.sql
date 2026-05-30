ALTER TABLE "youtube_sources" ADD COLUMN "backfill_days" integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "youtube_sources" ADD COLUMN "backfilled_at" timestamp with time zone;