/**
 * What a backup file holds, and the checks a file must pass before restore.
 *
 * A backup is your own data, as JSON: what you bought and sold, your items and
 * their pictures, price history, the watchlist and settings. It leaves out
 * what can be fetched again (the catalogue, YouTube crawl results) and
 * anything secret (the PriceCharting token).
 *
 * Restoring ADDS BACK and OVERWRITES rows with the same id; it never deletes
 * anything. So it is safe to run on a database that already has data: nothing
 * you have added since the backup disappears.
 */

export const BACKUP_FORMAT = "poke-investor-backup";
export const BACKUP_VERSION = 1;

export type BackupTable = {
  name: string;
  label: string;
  /** Columns that identify a row; a restored row replaces one with the same key. */
  pk: readonly string[];
  /**
   * Columns pointing at a table that is not in the backup (the catalogue). They
   * are restored only if the row they point at exists, otherwise left empty.
   */
  softRefs?: readonly { column: string; table: string; refColumn: string }[];
};

/** Parents before children, so every reference exists when it is needed. */
export const BACKUP_TABLES: readonly BackupTable[] = [
  {
    name: "items",
    label: "Items",
    pk: ["id"],
    softRefs: [
      {
        column: "catalog_product_id",
        table: "catalog_products",
        refColumn: "product_id",
      },
      {
        column: "raw_card_product_id",
        table: "catalog_products",
        refColumn: "product_id",
      },
    ],
  },
  { name: "transactions", label: "Buys and sells", pk: ["id"] },
  { name: "deleted_transactions", label: "Recently deleted", pk: ["id"] },
  { name: "market_prices", label: "Price history", pk: ["id"] },
  { name: "item_images", label: "Uploaded pictures", pk: ["item_id"] },
  { name: "watchlist_items", label: "Watchlist", pk: ["id"] },
  { name: "app_settings", label: "Settings", pk: ["key"] },
  { name: "fx_rates", label: "Exchange rates", pk: ["base", "quote"] },
];

/** Settings that are not backed up: a secret, and the backup's own bookkeeping. */
export const EXCLUDED_SETTING_KEYS = [
  "pricecharting_token",
  "last_backup_at",
] as const;

export const LAST_BACKUP_KEY = "last_backup_at";

export type Row = Record<string, unknown>;

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  tables: Record<string, Row[]>;
};

const MAX_ROWS = 1_000_000;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Check a parsed file. Returns the backup, or why it can't be used. */
export function validateBackup(
  raw: unknown,
): { ok: true; backup: Backup } | { ok: false; error: string } {
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) {
    return { ok: false, error: "This isn't a Poke Investor backup file." };
  }
  if (typeof raw.version !== "number" || raw.version > BACKUP_VERSION) {
    return {
      ok: false,
      error:
        "This backup was made by a newer version of the app. Update the app first.",
    };
  }
  if (!isObject(raw.tables)) {
    return { ok: false, error: "The backup has no data in it." };
  }
  const tables: Record<string, Row[]> = {};
  let total = 0;
  for (const t of BACKUP_TABLES) {
    const rows = raw.tables[t.name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      return {
        ok: false,
        error: `The "${t.label}" part of the backup is damaged.`,
      };
    }
    for (const r of rows) {
      if (
        !isObject(r) ||
        t.pk.some((k) => r[k] === undefined || r[k] === null)
      ) {
        return {
          ok: false,
          error: `The "${t.label}" part of the backup is damaged.`,
        };
      }
    }
    total += rows.length;
    tables[t.name] = rows as Row[];
  }
  if (total === 0) return { ok: false, error: "The backup has no rows in it." };
  if (total > MAX_ROWS) return { ok: false, error: "The backup is too large." };
  const createdAt =
    typeof raw.createdAt === "string" &&
    !Number.isNaN(Date.parse(raw.createdAt))
      ? raw.createdAt
      : new Date(0).toISOString();
  return {
    ok: true,
    backup: { format: BACKUP_FORMAT, version: raw.version, createdAt, tables },
  };
}

/** Columns to write for a table: those present in the file AND in the database. */
export function columnsToRestore(
  rows: readonly Row[],
  dbColumns: readonly string[],
): string[] {
  const inFile = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) inFile.add(k);
  return dbColumns.filter((c) => inFile.has(c));
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/**
 * The INSERT that restores one table from a JSON array (parameter $1):
 * rows with a new key are added, rows with a known key are overwritten.
 * Identifiers come from the fixed table list and the database, never the file.
 */
export function restoreSql(
  table: BackupTable,
  columns: readonly string[],
): string {
  const soft = new Map((table.softRefs ?? []).map((s) => [s.column, s]));
  const select = columns.map((c) => {
    const s = soft.get(c);
    if (!s) return `r.${q(c)}`;
    return `CASE WHEN EXISTS (SELECT 1 FROM ${q(s.table)} x WHERE x.${q(s.refColumn)} = r.${q(c)}) THEN r.${q(c)} END`;
  });
  const updatable = columns.filter((c) => !table.pk.includes(c));
  const conflict =
    updatable.length === 0
      ? "DO NOTHING"
      : `DO UPDATE SET ${updatable.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(", ")}`;
  return `INSERT INTO ${q(table.name)} (${columns.map(q).join(", ")})
SELECT ${select.join(", ")} FROM jsonb_populate_recordset(NULL::${q(table.name)}, $1::jsonb) r
ON CONFLICT (${table.pk.map(q).join(", ")}) ${conflict}`;
}

export type TableSummary = {
  name: string;
  label: string;
  inFile: number;
  /** Rows in the file whose key already exists (they would be overwritten). */
  existing: number;
  /** Rows in the database now. */
  inDatabase: number;
};

export function backupFileName(now: Date): string {
  return `poke-investor-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** Days since the last backup, or null if there never was one. */
export function daysSinceBackup(last: Date | null, now: Date): number | null {
  if (!last) return null;
  return Math.max(0, Math.floor((now.getTime() - last.getTime()) / 86_400_000));
}

/** A backup older than this is worth refreshing. */
export const BACKUP_STALE_DAYS = 30;
