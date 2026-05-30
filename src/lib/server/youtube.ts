"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { youtubeSources, type YoutubeSource } from "@/db/schema";
import { recognizeSourceInput, resolveYoutubeHandle } from "@/lib/youtube/parse";
import type { ActionResult } from "./items";

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listYoutubeSources(): Promise<YoutubeSource[]> {
  return db.select().from(youtubeSources).orderBy(asc(youtubeSources.addedAt));
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/** Shared by add + update: which backfill mode and the inputs it needs. */
const backfillSettingsSchema = z.object({
  backfillMode: z.enum(["count", "days"]).optional(),
  /** Used in `count` mode. Also the hard cap in `days` mode. */
  backfillMaxVideos: z.number().int().min(0).max(1000).optional(),
  /** Used in `days` mode. Ignored otherwise. */
  backfillDays: z.number().int().min(1).max(3650).optional(),
});

const addSchema = backfillSettingsSchema.extend({
  input: z.string().trim().min(1, "Paste a channel URL, @handle, or video URL"),
  title: z.string().trim().max(200).optional(),
});

export type AddYoutubeSourceInput = z.input<typeof addSchema>;

/**
 * Add a source. Accepts a channel URL/ID, `@handle`, or video URL/ID. For
 * `@handle` inputs we resolve to the underlying channel ID by scraping the
 * channel page (no API key required) — see `resolveYoutubeHandle`.
 */
export async function addYoutubeSource(
  raw: AddYoutubeSourceInput,
): Promise<ActionResult<YoutubeSource>> {
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const recognized = recognizeSourceInput(parsed.data.input);
  if (!recognized) {
    return {
      ok: false,
      error:
        "Couldn't recognize that as a YouTube channel or video. Paste a full URL or a `UC…` / 11-char ID.",
    };
  }

  // Handles need a network resolution to a channel ID.
  let kind: "channel" | "video";
  let externalId: string;
  let handle: string | null = null;
  let resolvedTitle: string | null = null;
  if (recognized.kind === "handle") {
    const resolved = await resolveYoutubeHandle(recognized.handle);
    if (!resolved) {
      return {
        ok: false,
        error: `Couldn't resolve ${recognized.handle} — handle not found, or the channel page changed format.`,
      };
    }
    kind = "channel";
    externalId = resolved.channelId;
    handle = recognized.handle;
    resolvedTitle = resolved.title ?? null;
  } else {
    kind = recognized.kind;
    externalId = recognized.externalId;
    handle = "handle" in recognized ? recognized.handle ?? null : null;
  }

  // Dedupe on (kind, externalId).
  const existing = await db
    .select()
    .from(youtubeSources)
    .where(
      and(
        eq(youtubeSources.kind, kind),
        eq(youtubeSources.externalId, externalId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { ok: false, error: "That source is already on the list." };
  }

  const inserted = await db
    .insert(youtubeSources)
    .values({
      kind,
      externalId,
      handle,
      title: parsed.data.title ?? resolvedTitle,
      // Only override schema defaults when the caller passed something.
      ...(parsed.data.backfillMode !== undefined
        ? { backfillMode: parsed.data.backfillMode }
        : {}),
      ...(parsed.data.backfillMaxVideos !== undefined
        ? { backfillMaxVideos: parsed.data.backfillMaxVideos }
        : {}),
      ...(parsed.data.backfillDays !== undefined
        ? { backfillDays: parsed.data.backfillDays }
        : {}),
    })
    .returning();

  revalidatePath("/sources");
  return { ok: true, data: inserted[0] };
}

const updateSchema = backfillSettingsSchema.extend({
  id: z.string().uuid(),
  /** When true (the default), clear `backfilled_at` so the next backfill
   * cron re-processes this source with the new settings. */
  requeueBackfill: z.boolean().default(true),
});

export type UpdateYoutubeSourceInput = z.input<typeof updateSchema>;

/**
 * Update the backfill settings on an existing source. Title, handle,
 * external_id, and active state stay where they are — those have their
 * own actions. Saving with `requeueBackfill: true` (default) clears
 * `backfilled_at` so the next `backfill` cron picks the source up again
 * with the new settings, even if it had been fully processed before.
 */
export async function updateYoutubeSource(
  raw: UpdateYoutubeSourceInput,
): Promise<ActionResult<YoutubeSource>> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const updates: Partial<{
    backfillMode: "count" | "days";
    backfillMaxVideos: number;
    backfillDays: number;
    backfilledAt: Date | null;
  }> = {};
  if (parsed.data.backfillMode !== undefined) {
    updates.backfillMode = parsed.data.backfillMode;
  }
  if (parsed.data.backfillMaxVideos !== undefined) {
    updates.backfillMaxVideos = parsed.data.backfillMaxVideos;
  }
  if (parsed.data.backfillDays !== undefined) {
    updates.backfillDays = parsed.data.backfillDays;
  }
  if (parsed.data.requeueBackfill) {
    updates.backfilledAt = null;
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: "Nothing to update." };
  }

  const [updated] = await db
    .update(youtubeSources)
    .set(updates)
    .where(eq(youtubeSources.id, parsed.data.id))
    .returning();
  if (!updated) {
    return { ok: false, error: "Source not found." };
  }

  revalidatePath("/sources");
  return { ok: true, data: updated };
}

export async function removeYoutubeSource(
  id: string,
): Promise<ActionResult<null>> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  await db.delete(youtubeSources).where(eq(youtubeSources.id, id));
  revalidatePath("/sources");
  return { ok: true, data: null };
}

export async function setYoutubeSourceActive(
  id: string,
  active: boolean,
): Promise<ActionResult<null>> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  await db
    .update(youtubeSources)
    .set({ active })
    .where(eq(youtubeSources.id, id));
  revalidatePath("/sources");
  return { ok: true, data: null };
}
