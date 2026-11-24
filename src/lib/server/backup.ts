import { pgClient } from "@/db/client";
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  EXCLUDED_SETTING_KEYS,
  LAST_BACKUP_KEY,
  columnsToRestore,
  restoreSql,
  type Backup,
  type BackupTable,
  type Row,
  type TableSummary,
} from "@/lib/calc/backup";

/**
 * Plain module (not "use server"): it is reached only through route handlers,
 * so it is never callable straight from the browser.
 *
 * Table and column names in the SQL below come from the fixed list in
 * calc/backup.ts and from the database itself, never from an uploaded file.
 */

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

type Sql = typeof pgClient;

async function dbColumns(sql: Sql, table: string): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table}
     ORDER BY ordinal_position`;
  return rows.map((r) => r.column_name);
}

/** Everything in the backup list as one object, ready to be written as JSON. */
export async function exportBackup(now = new Date()): Promise<Backup> {
  const tables: Record<string, Row[]> = {};
  for (const t of BACKUP_TABLES) {
    const where =
      t.name === "app_settings"
        ? `WHERE key NOT IN (${EXCLUDED_SETTING_KEYS.map((k) => `'${k}'`).join(", ")})`
        : "";
    const order = t.pk.map(q).join(", ");
    const [row] = await pgClient.unsafe<{ rows: Row[] }[]>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY ${order}), '[]'::jsonb) AS rows
         FROM ${q(t.name)} t ${where}`,
    );
    tables[t.name] = row.rows;
  }
  await pgClient`
    INSERT INTO app_settings (key, value) VALUES (${LAST_BACKUP_KEY}, ${now.toISOString()})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    tables,
  };
}

export async function getLastBackupAt(): Promise<Date | null> {
  const [row] = await pgClient<{ value: string }[]>`
    SELECT value FROM app_settings WHERE key = ${LAST_BACKUP_KEY}`;
  if (!row) return null;
  const d = new Date(row.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** What restoring this file would do, table by table. Changes nothing. */
export async function previewBackup(backup: Backup): Promise<TableSummary[]> {
  const out: TableSummary[] = [];
  for (const t of BACKUP_TABLES) {
    const rows = backup.tables[t.name] ?? [];
    const [{ n }] = await pgClient.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM ${q(t.name)}`,
    );
    let existing = 0;
    if (rows.length > 0) {
      const join = t.pk.map((k) => `x.${q(k)} = r.${q(k)}`).join(" AND ");
      const [{ n: e }] = await pgClient.unsafe<{ n: string }[]>(
        `SELECT count(*)::text AS n
           FROM jsonb_populate_recordset(NULL::${q(t.name)}, $1::jsonb) r
           JOIN ${q(t.name)} x ON ${join}`,
        [JSON.stringify(rows)],
      );
      existing = Number(e);
    }
    out.push({
      name: t.name,
      label: t.label,
      inFile: rows.length,
      existing,
      inDatabase: Number(n),
    });
  }
  return out;
}

/**
 * Put the backup's rows back. All or nothing: one transaction, so a problem
 * halfway leaves the database exactly as it was.
 */
export async function applyBackup(backup: Backup): Promise<TableSummary[]> {
  const summary = await previewBackup(backup);
  await pgClient.begin(async (tx) => {
    for (const t of BACKUP_TABLES) {
      const rows = backup.tables[t.name] ?? [];
      if (rows.length === 0) continue;
      const cols = columnsToRestore(rows, await dbColumns(tx as unknown as Sql, t.name));
      for (const k of t.pk) {
        if (!cols.includes(k)) throw new Error(`The "${t.label}" part has no ${k}.`);
      }
      await restoreTable(tx as unknown as Sql, t, cols, rows);
    }
  });
  return summary;
}

async function restoreTable(
  sql: Sql,
  t: BackupTable,
  cols: string[],
  rows: Row[],
): Promise<void> {
  // In slices, so one huge parameter never has to cross the wire.
  const SLICE = 2000;
  for (let i = 0; i < rows.length; i += SLICE) {
    await sql.unsafe(restoreSql(t, cols), [JSON.stringify(rows.slice(i, i + SLICE))]);
  }
}
