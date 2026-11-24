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
