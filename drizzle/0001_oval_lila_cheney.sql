CREATE TYPE "public"."mention_sentiment" AS ENUM('bullish', 'bearish', 'neutral', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."youtube_source_kind" AS ENUM('channel', 'video');--> statement-breakpoint
CREATE TYPE "public"."youtube_transcript_status" AS ENUM('ok', 'missing', 'error');--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"model" text NOT NULL,
	"temperature" double precision,
	"system_text" text NOT NULL,
	"user_template" text NOT NULL,
	"response_schema" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "youtube_insight_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"item_id" uuid,
	"raw_name" text NOT NULL,
	"set_hint" text,
	"product_type" text,
	"sentiment" "mention_sentiment" NOT NULL,
	"confidence" double precision,
	"timestamp_sec" integer,
	"quote" text
);
--> statement-breakpoint
CREATE TABLE "youtube_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" text NOT NULL,
	"prompt_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "youtube_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "youtube_source_kind" NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"handle" text,
	"active" boolean DEFAULT true NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_discovered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "youtube_transcripts" (
	"video_id" text PRIMARY KEY NOT NULL,
	"language" varchar(16),
	"text" text,
	"segments" jsonb,
	"status" "youtube_transcript_status" NOT NULL,
	"error_msg" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "youtube_videos" (
	"video_id" text PRIMARY KEY NOT NULL,
	"source_id" uuid,
	"title" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_title" text,
	"published_at" timestamp with time zone NOT NULL,
	"duration_sec" integer,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "youtube_insight_mentions" ADD CONSTRAINT "youtube_insight_mentions_insight_id_youtube_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."youtube_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_insight_mentions" ADD CONSTRAINT "youtube_insight_mentions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_insights" ADD CONSTRAINT "youtube_insights_video_id_youtube_videos_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."youtube_videos"("video_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_insights" ADD CONSTRAINT "youtube_insights_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_transcripts" ADD CONSTRAINT "youtube_transcripts_video_id_youtube_videos_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."youtube_videos"("video_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD CONSTRAINT "youtube_videos_source_id_youtube_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."youtube_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_name_version_uq" ON "prompts" USING btree ("name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_one_active_per_name" ON "prompts" USING btree ("name") WHERE "prompts"."is_active";--> statement-breakpoint
CREATE INDEX "youtube_insight_mentions_insight_idx" ON "youtube_insight_mentions" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "youtube_insight_mentions_item_idx" ON "youtube_insight_mentions" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_insights_video_prompt_uq" ON "youtube_insights" USING btree ("video_id","prompt_id");--> statement-breakpoint
CREATE INDEX "youtube_insights_video_idx" ON "youtube_insights" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_sources_kind_external_uq" ON "youtube_sources" USING btree ("kind","external_id");--> statement-breakpoint
CREATE INDEX "youtube_sources_active_idx" ON "youtube_sources" USING btree ("active");--> statement-breakpoint
CREATE INDEX "youtube_videos_source_idx" ON "youtube_videos" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "youtube_videos_published_idx" ON "youtube_videos" USING btree ("published_at");