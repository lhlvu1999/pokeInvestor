"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, ne } from "drizzle-orm";
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
  | { ok: true; data: T }
  | { ok: false; error: string };

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

export async function deleteItem(id: string): Promise<ActionResult<null>> {
  await db.delete(items).where(eq(items.id, id));
  revalidatePath("/items");
  revalidatePath("/");
  return { ok: true, data: null };
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
    const [source] = await tx.select().from(items).where(eq(items.id, id)).limit(1);
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
    const allOthers = await tx
      .select()
      .from(items)
      .where(ne(items.id, id));
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
};

export async function listItemsWithValuations(): Promise<ItemWithValuation[]> {
  const allItems = await db
    .select()
    .from(items)
    .orderBy(asc(items.name));
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
    return {
      item,
      valuation: valueHoldings(snap, latestPrice?.priceCents ?? null),
      latestPrice,
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

  return { item, valuation, latestPrice, transactions: itemTxs };
}
