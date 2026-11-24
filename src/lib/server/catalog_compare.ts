/**
 * Loaders for the Compare sets page: the chosen sets' daily histories, and a
 * search for sets to add. Pure reads (no "use server").
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bulkReleaseDates } from "@/lib/calc/set_list";
import type { SetDay } from "@/lib/calc/set_tracking";

export type CompareSet = {
  groupId: number;
  name: string;
  language: "en" | "ja";
  /** YYYY-MM-DD, or null when unknown or not a real release date. */
  releasedOn: string | null;
  /** Oldest first. */
  days: SetDay[];
};

type SetRow = {
  group_id: string;
  name: string;
  language: string;
  rel: string | null;
};

async function bulkDates(): Promise<Set<string>> {
  const rows = await db.execute<{ d: string | null }>(sql`
    SELECT to_char(published_on, 'YYYY-MM-DD') AS d FROM catalog_sets
  `);
  return bulkReleaseDates(rows.map((r) => r.d));
}

/** The chosen sets with their histories, in the order asked for. Unknown ids are skipped. */
export async function getCompareSets(
  ids: ReadonlyArray<number>,
): Promise<CompareSet[]> {
  if (ids.length === 0) return [];
  const idsJson = JSON.stringify(ids);
  const [sets, history, bulk] = await Promise.all([
    db.execute<SetRow>(sql`
      SELECT group_id::text AS group_id, name, language,
             to_char(published_on, 'YYYY-MM-DD') AS rel
        FROM catalog_sets
       WHERE group_id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb)::bigint)
    `),
    db.execute<{
      group_id: string;
      day: string;
      priced_count: number;
      total_cents: string | number;
      top20_cents: string | number;
      top10_cents: string | number;
    }>(sql`
      SELECT group_id::text AS group_id, to_char(day, 'YYYY-MM-DD') AS day,
             priced_count, total_cents, top20_cents, top10_cents
        FROM catalog_set_daily
       WHERE group_id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb)::bigint)
       ORDER BY group_id, day
    `),
    bulkDates(),
  ]);

  const daysBy = new Map<number, SetDay[]>();
  for (const r of history) {
    const list = daysBy.get(Number(r.group_id)) ?? [];
    list.push({
      day: r.day,
      priced: r.priced_count,
      top20: Number(r.top20_cents),
      top10: Number(r.top10_cents),
      total: Number(r.total_cents),
    });
    daysBy.set(Number(r.group_id), list);
  }
  const metaBy = new Map(sets.map((s) => [Number(s.group_id), s]));
  return ids.flatMap((id) => {
    const s = metaBy.get(id);
    if (!s) return [];
    return [
      {
        groupId: id,
        name: s.name,
        language: s.language === "ja" ? ("ja" as const) : ("en" as const),
        releasedOn: s.rel && !bulk.has(s.rel) ? s.rel : null,
        days: daysBy.get(id) ?? [],
      },
    ];
  });
}

export type SetMatch = {
  groupId: number;
  name: string;
  language: "en" | "ja";
  releasedOn: string | null;
};

/** Sets whose name or abbreviation contains `q`, newest first. */
export async function searchSets(q: string, limit = 12): Promise<SetMatch[]> {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const [rows, bulk] = await Promise.all([
    db.execute<SetRow>(sql`
      SELECT s.group_id::text AS group_id, s.name, s.language,
             to_char(s.published_on, 'YYYY-MM-DD') AS rel
        FROM catalog_sets s
       WHERE (s.name ILIKE ${like} OR s.abbreviation ILIKE ${like})
         AND EXISTS (SELECT 1 FROM catalog_set_daily d WHERE d.group_id = s.group_id)
       ORDER BY s.published_on DESC NULLS LAST, s.name
       LIMIT ${limit}
    `),
    bulkDates(),
  ]);
  return rows.map((r) => ({
    groupId: Number(r.group_id),
    name: r.name,
    language: r.language === "ja" ? "ja" : "en",
    releasedOn: r.rel && !bulk.has(r.rel) ? r.rel : null,
  }));
}
