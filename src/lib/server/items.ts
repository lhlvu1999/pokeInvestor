"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  items,
  marketPrices,
  transactions,
  type Item,
  type MarketPrice,
  type Transaction,
} from "@/db/schema";
import {
  computeHoldings,
  valueHoldings,
  type ItemValuation,
} from "@/lib/calc/holdings";
import { itemMatchKey } from "@/lib/import";

const itemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  setCode: z.string().trim().max(50).optional().or(z.literal("")),
  cardNumber: z.string().trim().max(50).optional().or(z.literal("")),
  imageUrl: z.string().trim().url().optional().or(z.literal("")),
  sourceUrl: z.string().trim().url().optional().or(z.literal("")),
  pricechartingId: z.string().trim().max(50).optional().or(z.literal("")),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

function toNullable(v: string | undefined): string | null {
  return v && v.length > 0 ? v : null;
}

export type CreateItemInput = z.input<typeof itemSchema>;

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

export async function createItem(
  input: CreateItemInput,
): Promise<ActionResult<Item>> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }

  const [created] = await db
    .insert(items)
    .values({
      name: parsed.data.name,
      setCode: toNullable(parsed.data.setCode),
      cardNumber: toNullable(parsed.data.cardNumber),
      imageUrl: toNullable(parsed.data.imageUrl),
      sourceUrl: toNullable(parsed.data.sourceUrl),
      pricechartingId: toNullable(parsed.data.pricechartingId),
      note: toNullable(parsed.data.note),
    })
    .returning();

  revalidatePath("/items");
  revalidatePath("/");
  return { ok: true, data: created };
}

export async function deleteItem(id: string): Promise<ActionResult<Item>> {
  const [existing] = await db
    .select()
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  if (!existing) return { ok: false, error: "Item not found" };
  await db.delete(items).where(eq(items.id, id));
  revalidatePath("/items");
  revalidatePath("/");
  return { ok: true, data: existing };
}

/**
 * Merge `sourceId` into `targetId`: move every transaction, market
 * price, insight-mention, and alias from source to target, then delete
 * source. Refuses if the two items don't share a currency (would
 * corrupt holdings math). Wrapped in a single transaction so a
 * partial-merge can't leave the DB inconsistent.
 */
export async function mergeItems(
  sourceId: string,
  targetId: string,
): Promise<ActionResult<{ targetId: string }>> {
  if (sourceId === targetId) {
    return { ok: false, error: "Source and target must differ." };
  }
  const [source] = await db
    .select()
    .from(items)
    .where(eq(items.id, sourceId))
    .limit(1);
  const [target] = await db
    .select()
    .from(items)
    .where(eq(items.id, targetId))
    .limit(1);
  if (!source || !target) return { ok: false, error: "Item not found." };

  // Currency check: gather distinct currencies across both items' txs.
  const allTxs = await db
    .select()
    .from(transactions)
    .where(sql`item_id in (${sourceId}, ${targetId})`);
  const currencies = new Set(allTxs.map((t) => t.currency));
  if (currencies.size > 1) {
    return {
      ok: false,
      error: `Currency mismatch: ${Array.from(currencies).join(" vs ")}. Items must share a currency to merge.`,
    };
  }

  // Alias merge — dedupe case-insensitively. The source's name becomes
  // an alias on the target so future mentions of the old name still
  // resolve. Skip if it's already an alias or matches the target name.
  const existingAliases = new Set(
    (target.aliases ?? []).map((a) => a.toLowerCase()),
  );
  const nextAliases = [...(target.aliases ?? [])];
  const push = (a: string) => {
    const key = a.trim().toLowerCase();
    if (!key || key === target.name.toLowerCase() || existingAliases.has(key))
      return;
    existingAliases.add(key);
    nextAliases.push(a.trim());
  };
  push(source.name);
  for (const a of source.aliases ?? []) push(a);

  // Tag merge — union.
  const nextTags = Array.from(
    new Set([...(target.tags ?? []), ...(source.tags ?? [])]),
  );

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`update transactions set item_id = ${targetId} where item_id = ${sourceId}`,
      );
      await tx.execute(
        sql`update market_prices set item_id = ${targetId} where item_id = ${sourceId}`,
      );
      await tx.execute(
        sql`update youtube_insight_mentions set item_id = ${targetId} where item_id = ${sourceId}`,
      );
      await tx
        .update(items)
        .set({ aliases: nextAliases, tags: nextTags })
        .where(eq(items.id, targetId));
      await tx.delete(items).where(eq(items.id, sourceId));
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? `Merge failed: ${err.message}` : "Merge failed",
    };
  }

  revalidatePath("/items");
  revalidatePath("/");
  revalidatePath(`/items/${targetId}`);
  return { ok: true, data: { targetId } };
}

/**
 * Re-insert a previously deleted item. Called by the toast "Undo"
 * handler within a few seconds of `deleteItem`. Preserves the original
 * `id` so any orphaned mentions (which are `on delete set null`) can
 * theoretically re-link if the row didn't have transactions — in
 * practice cascade-deleted transactions and market_prices are gone.
 */
export async function restoreItem(item: Item): Promise<ActionResult<Item>> {
  try {
    await db.insert(items).values(item);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not restore: ${err.message}`
          : "Could not restore item",
    };
  }
  revalidatePath("/items");
  revalidatePath("/");
  return { ok: true, data: item };
}

/**
 * Replace an item's tags. Tags are normalized: trimmed, lowercased,
 * deduplicated, max 24 chars per tag, max 12 tags per item.
 */
export async function setItemTags(
  id: string,
  rawTags: string[],
): Promise<ActionResult<string[]>> {
  if (!Array.isArray(rawTags)) {
    return { ok: false, error: "Invalid tags" };
  }
  const normalized = Array.from(
    new Set(
      rawTags
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 24),
    ),
  ).slice(0, 12);

  await db.update(items).set({ tags: normalized }).where(eq(items.id, id));
  revalidatePath("/items");
  revalidatePath("/");
  revalidatePath(`/items/${id}`);
  return { ok: true, data: normalized };
}

/** Normalize one alias string: trim, lowercase, collapse whitespace. */
function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Replace an item's aliases. Aliases are normalized: trimmed, lowercased,
 * whitespace-collapsed, deduplicated, max 120 chars per alias, max 30 per
 * item. Aliases that coincide with the item's name are silently dropped
 * (no point storing what the matcher already checks against).
 */
export async function setItemAliases(
  id: string,
  rawAliases: string[],
): Promise<ActionResult<string[]>> {
  if (!Array.isArray(rawAliases)) {
    return { ok: false, error: "Invalid aliases" };
  }
  // Need the item's canonical name to skip self-aliases.
  const [item] = await db
    .select({ name: items.name })
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  if (!item) return { ok: false, error: "Item not found" };
  const canonical = normalizeAlias(item.name);

  const normalized = Array.from(
    new Set(
      rawAliases
        .map(normalizeAlias)
        .filter((s) => s.length > 0 && s.length <= 120 && s !== canonical),
    ),
  ).slice(0, 30);

  await db.update(items).set({ aliases: normalized }).where(eq(items.id, id));
  revalidatePath("/items");
  revalidatePath("/");
  revalidatePath(`/items/${id}`);
  revalidatePath("/admin/mentions");
  revalidatePath("/insights");
  return { ok: true, data: normalized };
}

/**
 * Append one alias to an item (idempotent — duplicates are dropped).
 * Used by /admin/mentions when the user opts to "remember this raw name as
 * an alias" while linking an unmatched mention. Returns the resulting
 * alias list.
 */
export async function addItemAlias(
  id: string,
  rawAlias: string,
): Promise<ActionResult<string[]>> {
  const alias = normalizeAlias(rawAlias);
  if (alias.length === 0) return { ok: false, error: "Empty alias" };
  if (alias.length > 120) return { ok: false, error: "Alias too long" };

  const [item] = await db
    .select({ name: items.name, aliases: items.aliases })
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  if (!item) return { ok: false, error: "Item not found" };
  if (alias === normalizeAlias(item.name)) {
    // The matcher already covers the canonical name — no-op.
    return { ok: true, data: item.aliases };
  }
  if (item.aliases.includes(alias)) return { ok: true, data: item.aliases };
  if (item.aliases.length >= 30) {
    return { ok: false, error: "Alias limit reached (30)" };
  }
  const next = [...item.aliases, alias];
  await db.update(items).set({ aliases: next }).where(eq(items.id, id));
  revalidatePath(`/items/${id}`);
  revalidatePath("/admin/mentions");
  revalidatePath("/insights");
  return { ok: true, data: next };
}

/**
 * Returns every distinct tag in the system, sorted alphabetically.
 * Cheap enough for an MVP at the user's scale.
 */
export async function listAllTags(): Promise<string[]> {
  const rows = await db.select({ tags: items.tags }).from(items);
  const set = new Set<string>();
  for (const r of rows) {
    for (const t of r.tags) set.add(t);
  }
  return Array.from(set).sort();
}

const renameSchema = z.object({
  id: z.string().uuid(),
  newName: z.string().trim().min(1, "Name cannot be empty").max(200),
});

export type RenameItemInput = z.input<typeof renameSchema>;
export type RenameItemResult = {
  /** ID of the resulting item (may differ from input.id when merged into another). */
  itemId: string;
  /** True when the rename merged into an existing item with the same case-insensitive name. */
  merged: boolean;
};

/**
 * Rename an item. If the new name matches another item case-insensitively
 * (after trimming + Unicode normalization), this merges the source item's
 * transactions and prices into the target and deletes the source.
 *
 * Currency invariant: rejects merges that would put two currencies on one item.
 */
export async function renameItem(
  input: RenameItemInput,
): Promise<ActionResult<RenameItemResult>> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const { id, newName } = parsed.data;
  const newKey = itemMatchKey(newName);

  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(items)
      .where(eq(items.id, id))
      .limit(1);
    if (!source) return { ok: false as const, error: "Item not found" };

    if (itemMatchKey(source.name) === newKey) {
      // Same key; just update the display string (e.g. capitalisation tweak).
      if (source.name === newName) {
        return { ok: true as const, data: { itemId: id, merged: false } };
      }
      await tx.update(items).set({ name: newName }).where(eq(items.id, id));
      revalidatePath("/items");
      revalidatePath("/");
      revalidatePath(`/items/${id}`);
      return { ok: true as const, data: { itemId: id, merged: false } };
    }

    // Look for another item with the matching key.
    const allOthers = await tx.select().from(items).where(ne(items.id, id));
    const target = allOthers.find((it) => itemMatchKey(it.name) === newKey);

    if (!target) {
      // Plain rename, no merge.
      await tx.update(items).set({ name: newName }).where(eq(items.id, id));
      revalidatePath("/items");
      revalidatePath("/");
      revalidatePath(`/items/${id}`);
      return { ok: true as const, data: { itemId: id, merged: false } };
    }

    // Merge: enforce currency consistency before moving transactions.
    const [sourceCur] = await tx
      .select({ currency: transactions.currency })
      .from(transactions)
      .where(eq(transactions.itemId, id))
      .limit(1);
    const [targetCur] = await tx
      .select({ currency: transactions.currency })
      .from(transactions)
      .where(eq(transactions.itemId, target.id))
      .limit(1);
    if (sourceCur && targetCur && sourceCur.currency !== targetCur.currency) {
      return {
        ok: false as const,
        error: `Cannot merge: source is in ${sourceCur.currency}, target is in ${targetCur.currency}.`,
      };
    }

    // Reparent transactions and prices, then delete the source item.
    await tx
      .update(transactions)
      .set({ itemId: target.id })
      .where(eq(transactions.itemId, id));
    await tx
      .update(marketPrices)
      .set({ itemId: target.id })
      .where(and(eq(marketPrices.itemId, id)));
    await tx.delete(items).where(eq(items.id, id));

    revalidatePath("/items");
    revalidatePath("/");
    revalidatePath(`/items/${target.id}`);
    return {
      ok: true as const,
      data: { itemId: target.id, merged: true },
    };
  });
}

async function getLatestPricesByItem(): Promise<Map<string, MarketPrice>> {
  const rows = await db
    .select()
    .from(marketPrices)
    .orderBy(desc(marketPrices.fetchedAt));
  const out = new Map<string, MarketPrice>();
  for (const r of rows) {
    if (out.has(r.itemId)) continue;
    out.set(r.itemId, r);
  }
  return out;
}

export type ItemWithValuation = {
  item: Item;
  valuation: ItemValuation;
  latestPrice: MarketPrice | null;
  /** Timestamp of the most recent transaction, or null if none. Feeds
   * the "recently-touched first" default sort on the items list. */
  lastTxAt: Date | null;
};

export async function listItemsWithValuations(): Promise<ItemWithValuation[]> {
  const allItems = await db.select().from(items).orderBy(asc(items.name));
  if (allItems.length === 0) return [];

  const allTxs = await db.select().from(transactions);
  const byItem = new Map<string, Transaction[]>();
  for (const tx of allTxs) {
    const list = byItem.get(tx.itemId) ?? [];
    list.push(tx);
    byItem.set(tx.itemId, list);
  }

  const latestPrices = await getLatestPricesByItem();

  return allItems.map((item) => {
    const itemTxs = byItem.get(item.id) ?? [];
    const snap = computeHoldings(itemTxs);
    const latestPrice = latestPrices.get(item.id) ?? null;
    const lastTxAt =
      itemTxs.length === 0
        ? null
        : new Date(Math.max(...itemTxs.map((t) => t.occurredAt.getTime())));
    return {
      item,
      valuation: valueHoldings(snap, latestPrice?.priceCents ?? null),
      latestPrice,
      lastTxAt,
    };
  });
}

export type ItemDetail = ItemWithValuation & {
  transactions: Transaction[];
};

export async function getItemDetail(id: string): Promise<ItemDetail | null> {
  const [item] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!item) return null;

  const itemTxs = await db
    .select()
    .from(transactions)
    .where(eq(transactions.itemId, id))
    .orderBy(desc(transactions.occurredAt));

  const [latestPrice = null] = await db
    .select()
    .from(marketPrices)
    .where(eq(marketPrices.itemId, id))
    .orderBy(desc(marketPrices.fetchedAt))
    .limit(1);

  const snap = computeHoldings(itemTxs);
  const valuation = valueHoldings(snap, latestPrice?.priceCents ?? null);
  const lastTxAt =
    itemTxs.length === 0
      ? null
      : new Date(Math.max(...itemTxs.map((t) => t.occurredAt.getTime())));

  return { item, valuation, latestPrice, lastTxAt, transactions: itemTxs };
}
