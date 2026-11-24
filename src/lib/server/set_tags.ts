import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  planTagMerges,
  setTagName,
  type PlanItem,
  type TagProposal,
} from "@/lib/calc/set_tags";

/**
 * Every item with its tags and the tag of its catalogue set. An item's set is
 * that of its linked sealed product, or, for a graded slab, of the card it was
 * matched to. Plain module (a read), not "use server".
 */
type Row = { id: string; tags: string[] | null; set_name: string | null; language: string | null };

export async function loadPlanItems(): Promise<PlanItem[]> {
  const rows = await db.execute<Row>(sql`
    SELECT i.id::text AS id, i.tags,
           COALESCE(s1.name, s2.name) AS set_name,
           COALESCE(s1.language, s2.language) AS language
      FROM items i
      LEFT JOIN catalog_products p1 ON p1.product_id = i.catalog_product_id
      LEFT JOIN catalog_sets s1 ON s1.group_id = p1.group_id
      LEFT JOIN catalog_products p2 ON p2.product_id = i.raw_card_product_id
      LEFT JOIN catalog_sets s2 ON s2.group_id = p2.group_id
  `);
  return Array.from(rows).map((r) => ({
    id: r.id,
    tags: r.tags ?? [],
    setTag: r.set_name ? setTagName(r.set_name, r.language ?? "en") : null,
  }));
}

export type TagPlan = {
  proposals: TagProposal[];
  items: number;
  /** Items whose set is known (they could carry a set tag). */
  withSet: number;
  /** Of those, how many do not carry it yet. */
  missingSetTag: number;
  /** Your tags that are not offered (product types, or no linked item yet), with counts. */
  kept: { tag: string; count: number }[];
};

export async function getTagPlan(): Promise<TagPlan> {
  const items = await loadPlanItems();
  const withSet = items.filter((i) => i.setTag);
  const proposals = planTagMerges(items);
  const offered = new Set(proposals.map((p) => p.tag));
  const counts = new Map<string, number>();
  for (const it of items) for (const t of new Set(it.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const kept = [...counts]
    .filter(([t]) => !offered.has(t))
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return {
    proposals,
    kept,
    items: items.length,
    withSet: withSet.length,
    missingSetTag: withSet.filter((i) => !i.tags.includes(i.setTag as string)).length,
  };
}

/** The tag to add when an item gets linked to a catalogue product (any kind). */
export async function setTagOfProduct(productId: number): Promise<string | null> {
  const rows = await db.execute<{ name: string; language: string }>(sql`
    SELECT s.name, s.language FROM catalog_products p
      JOIN catalog_sets s ON s.group_id = p.group_id
     WHERE p.product_id = ${productId}
  `);
  const r = Array.from(rows)[0];
  return r ? setTagName(r.name, r.language) : null;
}
