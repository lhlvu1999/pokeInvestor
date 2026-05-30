"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import {
  appSettings,
  fxRates,
  items,
  marketPrices,
  transactions,
} from "@/db/schema";
import type { ActionResult } from "./items";

/* ------------------------------------------------------------------ */
/* Transaction status — bulk                                           */
/* ------------------------------------------------------------------ */

export type StatusCounts = {
  receivedBuys: number;
  pendingBuys: number;
  sells: number;
  total: number;
};

export async function getStatusCounts(): Promise<StatusCounts> {
  const rows = await db
    .select({ type: transactions.type, status: transactions.status })
    .from(transactions);
  let receivedBuys = 0;
  let pendingBuys = 0;
  let sells = 0;
  for (const r of rows) {
    if (r.type === "sell") sells += 1;
    else if (r.status === "received") receivedBuys += 1;
    else pendingBuys += 1;
  }
  return {
    receivedBuys,
    pendingBuys,
    sells,
    total: rows.length,
  };
}

/**
 * Flip every BUY transaction to the given status. Sells are unaffected
 * (they're always logically received).
 */
export async function bulkSetBuyStatus(
  status: "pending" | "received",
): Promise<ActionResult<{ updated: number }>> {
  const result = await db
    .update(transactions)
    .set({ status })
    .where(eq(transactions.type, "buy"))
    .returning({ id: transactions.id });
  revalidatePath("/", "layout");
  return { ok: true, data: { updated: result.length } };
}

/* ------------------------------------------------------------------ */
/* Bulk auto-tag items by name pattern                                 */
/* ------------------------------------------------------------------ */

type Rule = {
  tag: string;
  /** Returns true if the (lowercased) name matches the rule. */
  match: (name: string) => boolean;
};

const RULES: Rule[] = [
  { tag: "etb", match: (n) => /^etb\b/.test(n) },
  { tag: "box", match: (n) => /^box\b/.test(n) || /\bbooster box\b/.test(n) },
  { tag: "booster", match: (n) => /\bbooster\b/.test(n) },
  { tag: "case", match: (n) => /^case\b/.test(n) },
  { tag: "slab", match: (n) => /^slab(s)?\b/.test(n) },
  { tag: "collection", match: (n) => /\bcollection\b/.test(n) },
  { tag: "bundle", match: (n) => /\bbundle\b/.test(n) },
  { tag: "tin", match: (n) => /\btin\b/.test(n) },
  { tag: "blister", match: (n) => /\bblister\b/.test(n) },
  { tag: "promo", match: (n) => /^promo\b/.test(n) },
  { tag: "mega", match: (n) => /^mega\b/.test(n) || /\bmega\s*\d/.test(n) },
  { tag: "bb", match: (n) => /^bb\b/.test(n) },
  {
    tag: "build-battle",
    match: (n) => /\bbuild battle\b/.test(n),
  },
];

export type AutoTagPlanEntry = {
  itemId: string;
  itemName: string;
  currentTags: string[];
  addedTags: string[];
};

export type AutoTagPreview = {
  totalItems: number;
  willChange: number;
  perTag: Record<string, number>;
  sample: AutoTagPlanEntry[];
};

function computeAddedTags(name: string, current: string[]): string[] {
  const lower = name.trim().toLowerCase();
  const added: string[] = [];
  for (const rule of RULES) {
    if (rule.match(lower) && !current.includes(rule.tag)) {
      added.push(rule.tag);
    }
  }
  return added;
}

/**
 * Dry-run: compute which tags would be added to which items, without
 * touching the DB. Returns a summary + a small sample for preview.
 */
export async function previewAutoTag(): Promise<AutoTagPreview> {
  const all = await db.select().from(items);
  const perTag: Record<string, number> = {};
  let willChange = 0;
  const changes: AutoTagPlanEntry[] = [];

  for (const it of all) {
    const added = computeAddedTags(it.name, it.tags);
    if (added.length === 0) continue;
    willChange += 1;
    for (const t of added) perTag[t] = (perTag[t] ?? 0) + 1;
    changes.push({
      itemId: it.id,
      itemName: it.name,
      currentTags: it.tags,
      addedTags: added,
    });
  }

  return {
    totalItems: all.length,
    willChange,
    perTag,
    sample: changes.slice(0, 30),
  };
}

export async function applyAutoTag(): Promise<
  ActionResult<{ itemsUpdated: number; tagsAdded: number }>
> {
  const all = await db.select().from(items);
  let itemsUpdated = 0;
  let tagsAdded = 0;

  await db.transaction(async (tx) => {
    for (const it of all) {
      const added = computeAddedTags(it.name, it.tags);
      if (added.length === 0) continue;
      const next = Array.from(new Set([...it.tags, ...added])).sort();
      await tx.update(items).set({ tags: next }).where(eq(items.id, it.id));
      itemsUpdated += 1;
      tagsAdded += added.length;
    }
  });

  revalidatePath("/", "layout");
  return { ok: true, data: { itemsUpdated, tagsAdded } };
}

/* ------------------------------------------------------------------ */
/* Wipe all data                                                       */
/* ------------------------------------------------------------------ */

export type WipeSummary = {
  items: number;
  transactions: number;
  marketPrices: number;
  fxRates: number;
  settings: number;
};

export async function getDataSummary(): Promise<WipeSummary> {
  const [iCount, tCount, mCount, fCount, sCount] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(items),
    db.select({ n: sql<number>`count(*)::int` }).from(transactions),
    db.select({ n: sql<number>`count(*)::int` }).from(marketPrices),
    db.select({ n: sql<number>`count(*)::int` }).from(fxRates),
    db.select({ n: sql<number>`count(*)::int` }).from(appSettings),
  ]);
  return {
    items: iCount[0]?.n ?? 0,
    transactions: tCount[0]?.n ?? 0,
    marketPrices: mCount[0]?.n ?? 0,
    fxRates: fCount[0]?.n ?? 0,
    settings: sCount[0]?.n ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Schema sync — idempotent ALTERs to catch the DB up to current code  */
/* ------------------------------------------------------------------ */

export type SyncSchemaStep = {
  sql: string;
  ran: boolean;
  error?: string;
};

export type SyncSchemaResult = {
  steps: SyncSchemaStep[];
  ranCount: number;
  failedCount: number;
};

/**
 * Brings the live database up to whatever the code currently declares in
 * `src/db/schema.ts`. Every statement is idempotent — re-running is safe.
 *
 * Use this instead of `db:reset` when you want to apply schema changes
 * without losing data.
 */
export async function syncSchema(): Promise<ActionResult<SyncSchemaResult>> {
  // Each entry is a raw SQL string that must be safe to re-run.
  const statements: string[] = [
    // Enum types — guarded by exception block (no IF NOT EXISTS for CREATE TYPE).
    `DO $$ BEGIN
       CREATE TYPE transaction_status AS ENUM ('pending', 'received');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,

    // ALTER TYPE ADD VALUE supports IF NOT EXISTS natively.
    `ALTER TYPE price_source ADD VALUE IF NOT EXISTS 'pricecharting'`,

    // items: optional metadata + tags.
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS source_url text`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS pricecharting_id text`,
    `ALTER TABLE items ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[]`,
    `CREATE INDEX IF NOT EXISTS items_tags_idx ON items USING gin (tags)`,

    // transactions: lot tracking, fulfillment status, shipping breakdown.
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS lot_id uuid`,
    `CREATE INDEX IF NOT EXISTS transactions_lot_idx ON transactions USING btree (lot_id)`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status transaction_status NOT NULL DEFAULT 'received'`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS shipping_cents bigint`,
  ];

  const steps: SyncSchemaStep[] = [];
  let ran = 0;
  let failed = 0;

  for (const stmt of statements) {
    try {
      // Use the raw postgres client directly because some of these (notably
      // ALTER TYPE ADD VALUE) cannot run inside an outer transaction. Each
      // statement is its own implicit transaction in PG.
      await pgClient.unsafe(stmt);
      steps.push({ sql: stmt, ran: true });
      ran += 1;
    } catch (err) {
      steps.push({
        sql: stmt,
        ran: false,
        error: err instanceof Error ? err.message : String(err),
      });
      failed += 1;
    }
  }

  revalidatePath("/", "layout");
  // Always return ok=true with the full step list — the UI inspects
  // failedCount to know whether something went wrong, so we don't lose the
  // detail when there's a partial failure.
  return { ok: true, data: { steps, ranCount: ran, failedCount: failed } };
}

/**
 * Delete every row in items, transactions, market_prices, fx_rates,
 * app_settings. Schema stays — equivalent to `db:reset` without touching
 * Docker.
 */
export async function wipeAllData(
  confirmation: string,
): Promise<ActionResult<WipeSummary>> {
  if (confirmation !== "DELETE EVERYTHING") {
    return {
      ok: false,
      error: 'Type "DELETE EVERYTHING" exactly to confirm.',
    };
  }
  const before = await getDataSummary();
  await db.transaction(async (tx) => {
    // Children first to satisfy FKs.
    await tx.delete(marketPrices);
    await tx.delete(transactions);
    await tx.delete(items);
    await tx.delete(fxRates);
    await tx.delete(appSettings);
  });
  revalidatePath("/", "layout");
  return { ok: true, data: before };
}
