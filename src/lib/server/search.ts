"use server";

/**
 * Global item search used by the header typeahead. Matches on name +
 * aliases (case-insensitive substring). Returns up to 12 hits ordered by
 * best match — exact-prefix first, then substring.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";

export type SearchHit = {
  id: string;
  name: string;
  imageUrl: string | null;
  setCode: string | null;
  cardNumber: string | null;
};

export async function searchItems(qRaw: string): Promise<SearchHit[]> {
  const q = qRaw.trim().toLowerCase();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const prefix = `${q}%`;
  const rows = await db
    .select({
      id: items.id,
      name: items.name,
      imageUrl: items.imageUrl,
      setCode: items.setCode,
      cardNumber: items.cardNumber,
    })
    .from(items)
    .where(
      sql`lower(${items.name}) like ${like} escape '\\'
          or exists (
            select 1 from unnest(coalesce(${items.aliases}, '{}'::text[])) a
            where a like ${like} escape '\\'
          )`,
    )
    .orderBy(
      // Prefix hits float to the top; then shortest name, then alphabetical.
      sql`(case when lower(${items.name}) like ${prefix} then 0 else 1 end), length(${items.name}), ${items.name}`,
    )
    .limit(12);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    imageUrl: r.imageUrl,
    setCode: r.setCode,
    cardNumber: r.cardNumber,
  }));
}
