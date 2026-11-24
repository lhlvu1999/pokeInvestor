import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  EXCLUDED_SETTING_KEYS,
  columnsToRestore,
  daysSinceBackup,
  restoreSql,
  validateBackup,
} from "./backup";

const good = () => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  createdAt: "2026-11-24T00:00:00.000Z",
  tables: { items: [{ id: "a", name: "Box" }] },
});

describe("validateBackup", () => {
  it("accepts a well-formed file and keeps only known tables", () => {
    const r = validateBackup({
      ...good(),
      tables: { ...good().tables, youtube_videos: [{ video_id: "x" }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.backup.tables)).toEqual(["items"]);
  });

  it("rejects other files, newer versions and empty backups", () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup({ format: "other" }).ok).toBe(false);
    expect(validateBackup({ ...good(), version: BACKUP_VERSION + 1 }).ok).toBe(false);
    expect(validateBackup({ ...good(), tables: {} }).ok).toBe(false);
    expect(validateBackup({ ...good(), tables: { items: [] } }).ok).toBe(false);
    expect(validateBackup({ ...good(), tables: "x" }).ok).toBe(false);
  });

  it("rejects a table that is damaged or missing its key", () => {
    expect(validateBackup({ ...good(), tables: { items: "no" } }).ok).toBe(false);
    expect(validateBackup({ ...good(), tables: { items: [{ name: "x" }] } }).ok).toBe(false);
    expect(validateBackup({ ...good(), tables: { items: [{ id: null }] } }).ok).toBe(false);
    expect(validateBackup({ ...good(), tables: { items: ["x"] } }).ok).toBe(false);
  });

  it("needs every part of a composite key", () => {
    const rate = { fx_rates: [{ base: "USD" }] };
    expect(validateBackup({ ...good(), tables: rate }).ok).toBe(false);
    expect(
      validateBackup({ ...good(), tables: { fx_rates: [{ base: "USD", quote: "VND" }] } }).ok,
    ).toBe(true);
  });

  it("tolerates a missing or bad date", () => {
    const r = validateBackup({ ...good(), createdAt: "nonsense" });
    expect(r.ok).toBe(true);
  });
});

describe("table list", () => {
  it("lists parents before children", () => {
    const names = BACKUP_TABLES.map((t) => t.name);
    for (const child of ["transactions", "market_prices", "item_images", "deleted_transactions"]) {
      expect(names.indexOf("items")).toBeLessThan(names.indexOf(child));
    }
  });
  it("never includes secrets or its own bookkeeping", () => {
    expect(EXCLUDED_SETTING_KEYS).toContain("pricecharting_token");
    expect(EXCLUDED_SETTING_KEYS).toContain("last_backup_at");
  });
});

describe("columnsToRestore", () => {
  it("keeps columns in the file and in the database, in database order", () => {
    expect(
      columnsToRestore([{ b: 1, a: 2 }, { c: 3 }], ["a", "b", "z"]),
    ).toEqual(["a", "b"]);
  });
  it("drops columns the database no longer has", () => {
    expect(columnsToRestore([{ old: 1, id: "x" }], ["id"])).toEqual(["id"]);
  });
});

describe("restoreSql", () => {
  const items = BACKUP_TABLES.find((t) => t.name === "items")!;
  const sql = restoreSql(items, ["id", "name", "catalog_product_id"]);

  it("upserts on the key and overwrites the other columns", () => {
    expect(sql).toContain('ON CONFLICT ("id") DO UPDATE SET');
    expect(sql).toContain('"name" = EXCLUDED."name"');
    expect(sql).not.toContain('"id" = EXCLUDED."id"');
  });
  it("only restores a catalogue link whose product exists", () => {
    expect(sql).toContain('FROM "catalog_products" x WHERE x."product_id" = r."catalog_product_id"');
  });
  it("only restores a slab's card link whose card exists too", () => {
    const sql2 = restoreSql(items, ["id", "raw_card_product_id"]);
    expect(sql2).toContain('x."product_id" = r."raw_card_product_id"');
  });
  it("does nothing on conflict when there is nothing to update", () => {
    const img = BACKUP_TABLES.find((t) => t.name === "item_images")!;
    expect(restoreSql(img, ["item_id"])).toContain("DO NOTHING");
  });
  it("handles composite keys", () => {
    const fx = BACKUP_TABLES.find((t) => t.name === "fx_rates")!;
    expect(restoreSql(fx, ["base", "quote", "rate"])).toContain('ON CONFLICT ("base", "quote")');
  });
  it("quotes identifiers", () => {
    const evil = { name: 'a"b', label: "x", pk: ["id"] } as const;
    expect(restoreSql(evil, ["id"])).toContain('"a""b"');
  });
});

describe("daysSinceBackup", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  it("is null when there never was one", () => {
    expect(daysSinceBackup(null, now)).toBeNull();
  });
  it("counts whole days and never goes negative", () => {
    expect(daysSinceBackup(new Date("2026-11-20T13:00:00Z"), now)).toBe(3);
    expect(daysSinceBackup(new Date("2026-11-25T00:00:00Z"), now)).toBe(0);
  });
});
