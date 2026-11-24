import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Every table and column that src/db/schema.ts declares but the database at
 * `url` does not have. Read-only. Used by `npm run check:schema` and at the end
 * of `npm run db:migrate`.
 */
export async function missingFromDatabase(url: string): Promise<string[]> {
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'`;
    const have = new Map<string, Set<string>>();
    for (const r of rows) {
      const cols = have.get(r.table_name) ?? new Set<string>();
      cols.add(r.column_name);
      have.set(r.table_name, cols);
    }
    const missing: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const cfg = getTableConfig(value);
      const cols = have.get(cfg.name);
      if (!cols) {
        missing.push(`table ${cfg.name}`);
        continue;
      }
      for (const c of cfg.columns) {
        if (!cols.has(c.name)) missing.push(`column ${cfg.name}.${c.name}`);
      }
    }
    return missing;
  } finally {
    await sql.end();
  }
}
