/**
 * Per-source pipeline observability. One SQL round-trip returns the counts
 * every SourceCard needs to render — videos discovered, transcripts by
 * status, insights extracted, last error message. Kept separate from
 * `youtube.ts` (which is a "use server" mutations module) so this pure
 * read isn't inadvertently exposed as a client-callable server action.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export type YoutubeSourceStats = {
  sourceId: string;
  videoCount: number;
  transcriptOk: number;
  transcriptMissing: number;
  transcriptError: number;
  transcriptPending: number;
  insightCount: number;
  insightPending: number;
  lastTranscriptError: string | null;
  lastTranscriptErrorAt: Date | null;
};

export type PipelineHealth = {
  totalVideos: number;
  totalTranscriptError: number;
  totalTranscriptPending: number;
  totalInsightPending: number;
  totalInsights: number;
};

/**
 * Aggregate pipeline stats per source in one query. Uses left joins so
 * a source with zero videos still shows up (all zeroed).
 */
export async function getYoutubeSourceStats(): Promise<
  Map<string, YoutubeSourceStats>
> {
  const rows = await db.execute<{
    source_id: string;
    video_count: string;
    transcript_ok: string;
    transcript_missing: string;
    transcript_error: string;
    transcript_pending: string;
    insight_count: string;
    insight_pending: string;
    last_transcript_error: string | null;
    last_transcript_error_at: Date | null;
  }>(sql`
    with per_video as (
      select
        v.video_id,
        v.source_id,
        t.status         as tr_status,
        t.error_msg      as tr_err,
        t.fetched_at     as tr_at,
        exists(select 1 from youtube_insights i where i.video_id = v.video_id) as has_insight
      from youtube_videos v
      left join youtube_transcripts t on t.video_id = v.video_id
      where v.source_id is not null
    ),
    last_err as (
      select distinct on (source_id)
        source_id, tr_err as error_msg, tr_at as at
      from per_video
      where tr_status = 'error' and tr_err is not null
      order by source_id, tr_at desc
    )
    select
      pv.source_id::text as source_id,
      count(*)::text                                                                as video_count,
      count(*) filter (where pv.tr_status = 'ok')::text                             as transcript_ok,
      count(*) filter (where pv.tr_status = 'missing')::text                        as transcript_missing,
      count(*) filter (where pv.tr_status = 'error')::text                          as transcript_error,
      count(*) filter (where pv.tr_status is null)::text                            as transcript_pending,
      count(*) filter (where pv.has_insight)::text                                  as insight_count,
      count(*) filter (where pv.tr_status = 'ok' and not pv.has_insight)::text      as insight_pending,
      le.error_msg                                                                   as last_transcript_error,
      le.at                                                                          as last_transcript_error_at
    from per_video pv
    left join last_err le on le.source_id = pv.source_id
    group by pv.source_id, le.error_msg, le.at
  `);

  const out = new Map<string, YoutubeSourceStats>();
  for (const r of rows) {
    out.set(r.source_id, {
      sourceId: r.source_id,
      videoCount: Number(r.video_count),
      transcriptOk: Number(r.transcript_ok),
      transcriptMissing: Number(r.transcript_missing),
      transcriptError: Number(r.transcript_error),
      transcriptPending: Number(r.transcript_pending),
      insightCount: Number(r.insight_count),
      insightPending: Number(r.insight_pending),
      lastTranscriptError: r.last_transcript_error,
      lastTranscriptErrorAt: r.last_transcript_error_at
        ? new Date(r.last_transcript_error_at)
        : null,
    });
  }
  return out;
}

/** Portfolio-wide totals for the health strip at the top of /sources. */
export async function getPipelineHealth(): Promise<PipelineHealth> {
  const [row] = await db.execute<{
    total_videos: string;
    total_transcript_error: string;
    total_transcript_pending: string;
    total_insight_pending: string;
    total_insights: string;
  }>(sql`
    select
      count(v.*)::text                                                                        as total_videos,
      count(*) filter (where t.status = 'error')::text                                        as total_transcript_error,
      count(*) filter (where t.status is null)::text                                          as total_transcript_pending,
      count(*) filter (where t.status = 'ok'
                       and not exists(select 1 from youtube_insights i where i.video_id = v.video_id))::text as total_insight_pending,
      (select count(*)::text from youtube_insights)                                            as total_insights
    from youtube_videos v
    left join youtube_transcripts t on t.video_id = v.video_id
  `);
  return {
    totalVideos: Number(row.total_videos ?? 0),
    totalTranscriptError: Number(row.total_transcript_error ?? 0),
    totalTranscriptPending: Number(row.total_transcript_pending ?? 0),
    totalInsightPending: Number(row.total_insight_pending ?? 0),
    totalInsights: Number(row.total_insights ?? 0),
  };
}
