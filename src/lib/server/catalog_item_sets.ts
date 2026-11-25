/**
 * The catalogue set each item belongs to, by item id: that of its linked sealed
 * product or, for a graded slab, of the card it was matched to. A plain read.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export async function loadItemSetNames(): Promise<Record<string, string>> {
  const rows = await db.execute<{ id: string; set_name: string }>(sql`
    SELECT i.id::text AS id, COALESCE(s1.name, s2.name) AS set_name
      FROM items i
      LEFT JOIN catalog_products p1 ON p1.product_id = i.catalog_product_id
      LEFT JOIN catalog_sets s1 ON s1.group_id = p1.group_id
      LEFT JOIN catalog_products p2 ON p2.product_id = i.raw_card_product_id
      LEFT JOIN catalog_sets s2 ON s2.group_id = p2.group_id
     WHERE COALESCE(s1.name, s2.name) IS NOT NULL
  `);
  const out: Record<string, string> = {};
  for (const r of Array.from(rows)) out[r.id] = r.set_name;
  return out;
}
