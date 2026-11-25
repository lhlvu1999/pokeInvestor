"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  MAX_TAG_LENGTH,
  applyTagMerge,
  planTagMerges,
} from "@/lib/calc/set_tags";
import type { ActionResult } from "./items";
import { loadPlanItems } from "./set_tags";

const MAX_CHOSEN = 200;

export type MergeSummary = {
  renamed: number;
  added: number;
  /** Items skipped because they already carry the most tags allowed. */
  full: number;
  /** Items left alone because their tags were changed while this ran. */
  conflicts: number;
};

/**
 * Rename the chosen tags of yours to their catalogue set's name, and optionally
 * give every other item with a known set its set tag.
 *
 * The browser sends only WHICH tags to rename. The proposals themselves are
 * worked out again here from the database, so a request cannot rename a tag to
 * anything the data does not support. An item is only updated if its tags are
 * still what they were when read, so an edit made at the same moment is kept.
 */
export async function applySetTagMerge(
  oldTags: string[],
  alsoTagOthers: boolean,
): Promise<ActionResult<MergeSummary>> {
  if (
    !Array.isArray(oldTags) ||
    oldTags.length > MAX_CHOSEN ||
    oldTags.some((t) => typeof t !== "string" || t.length > MAX_TAG_LENGTH)
  ) {
    return { ok: false, error: "Invalid selection" };
  }
  const items = await loadPlanItems();
  const proposals = planTagMerges(items);
  const result = applyTagMerge(items, proposals, new Set(oldTags), alsoTagOthers === true);

  let conflicts = 0;
  await db.transaction(async (tx) => {
    for (const c of result.changes) {
      const rows = await tx.execute(sql`
        UPDATE items
           SET tags = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(c.after)}::jsonb))
         WHERE id = ${c.id}::uuid
           AND tags = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(c.before)}::jsonb))
        RETURNING id
      `);
      if (Array.from(rows).length === 0) conflicts += 1;
    }
  });
  for (const p of ["/", "/items", "/items/tags", "/analytics", "/analytics/exposure"]) revalidatePath(p);
  return {
    ok: true,
    data: { renamed: result.renamed, added: result.added, full: result.full, conflicts },
  };
}

/* ------------------------------------------------------------------ */
/* Remove or rename one tag everywhere                                 */
/* ------------------------------------------------------------------ */

type TagRow = { id: string; tags: string[] };

function cleanTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return t.length > 0 && t.length <= MAX_TAG_LENGTH ? t : null;
}

/** Items that carry `tag`, with their tags as stored. */
async function carriers(tag: string): Promise<TagRow[]> {
  const rows = await db.execute<TagRow>(sql`
    SELECT id::text AS id, tags FROM items WHERE ${tag} = ANY(tags)
  `);
  return Array.from(rows).map((r) => ({ id: r.id, tags: r.tags ?? [] }));
}

async function writeTags(changes: { id: string; before: string[]; after: string[] }[]): Promise<number> {
  let written = 0;
  await db.transaction(async (tx) => {
    for (const c of changes) {
      // Only if the item's tags are still what they were when read.
      const rows = await tx.execute(sql`
        UPDATE items
           SET tags = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(c.after)}::jsonb))
         WHERE id = ${c.id}::uuid
           AND tags = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(c.before)}::jsonb))
        RETURNING id
      `);
      if (Array.from(rows).length > 0) written += 1;
    }
  });
  for (const p of ["/", "/items", "/items/tags", "/analytics", "/analytics/exposure"]) revalidatePath(p);
  return written;
}

/** Take a tag off every item that carries it. The items themselves are untouched. */
export async function removeTagEverywhere(
  tag: string,
): Promise<ActionResult<{ items: number }>> {
  const t = cleanTag(tag);
  if (!t) return { ok: false, error: "Invalid tag" };
  const rows = await carriers(t);
  const written = await writeTags(
    rows.map((r) => ({ id: r.id, before: r.tags, after: r.tags.filter((x) => x !== t) })),
  );
  return { ok: true, data: { items: written } };
}

/**
 * Rename a tag everywhere, or merge it into another tag that already exists: an item
 * that carries both ends up with the new one once. The new name is normalized like
 * any tag (trimmed, lower-case, at most 40 characters).
 */
export async function renameTagEverywhere(
  tag: string,
  newTag: string,
): Promise<ActionResult<{ items: number; into: string }>> {
  const from = cleanTag(tag);
  const to = cleanTag(newTag);
  if (!from) return { ok: false, error: "Invalid tag" };
  if (!to) return { ok: false, error: `Give a name of 1 to ${MAX_TAG_LENGTH} characters.` };
  if (from === to) return { ok: false, error: "That is the same tag." };
  const rows = await carriers(from);
  const written = await writeTags(
    rows.map((r) => ({
      id: r.id,
      before: r.tags,
      after: [...new Set(r.tags.map((x) => (x === from ? to : x)))],
    })),
  );
  return { ok: true, data: { items: written, into: to } };
}
