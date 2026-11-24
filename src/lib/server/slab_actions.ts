"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import { escapeLike, searchTokens } from "@/lib/calc/slab";
import { MAX_TAGS_PER_ITEM } from "@/lib/calc/set_tags";
import { getSetDetail } from "./catalog_live";
import { setTagOfProduct } from "./set_tags";
import type { ActionResult } from "./items";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function set(
  id: string,
  values: { rawCardProductId: null; rawCardSkipped: boolean },
): Promise<ActionResult<null>> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid item" };
  const rows = await db
    .update(items)
    .set(values)
    .where(eq(items.id, id))
    .returning({ id: items.id });
  if (rows.length === 0) return { ok: false, error: "Item not found" };
  revalidatePath("/analytics/slabs");
  return { ok: true, data: null };
}

/** The matched card is the wrong one: forget it, and never match this slab again. */
export async function rejectRawCard(id: string): Promise<ActionResult<null>> {
  return set(id, { rawCardProductId: null, rawCardSkipped: true });
}

/** Let the daily sync try to match this slab again. */
export async function allowRawCardMatch(id: string): Promise<ActionResult<null>> {
  return set(id, { rawCardProductId: null, rawCardSkipped: false });
}

export type CardHit = {
  productId: number;
  name: string;
  number: string | null;
  setName: string;
  groupId: number;
  language: string;
  imageUrl: string | null;
};

type HitRow = {
  product_id: string | number;
  name: string;
  card_number: string | null;
  set_name: string;
  group_id: string | number;
  language: string;
  image_url: string | null;
};

const MAX_HITS = 15;

/**
 * Find catalogue cards for a slab you want to match by hand. Every word you type
 * must appear in the card's name or number. The search is read-only.
 */
export async function searchRawCards(query: string): Promise<ActionResult<CardHit[]>> {
  const tokens = searchTokens(String(query).slice(0, 120));
  if (tokens.length === 0) return { ok: false, error: "Type a name or a card number." };
  const conditions = tokens.map((t) => {
    const e = escapeLike(t);
    return sql`(p.name ILIKE ${`%${e}%`} ESCAPE '\\' OR p.card_number ILIKE ${`${e}%`} ESCAPE '\\')`;
  });
  const rows = await db.execute<HitRow>(sql`
    SELECT p.product_id, p.name, p.card_number, s.name AS set_name, p.group_id, s.language, p.image_url
      FROM catalog_products p
      JOIN catalog_sets s ON s.group_id = p.group_id
     WHERE p.kind = 'card' AND ${sql.join(conditions, sql` AND `)}
     ORDER BY s.published_on DESC NULLS LAST, p.name
     LIMIT ${MAX_HITS}
  `);
  return {
    ok: true,
    data: Array.from(rows).map((r) => ({
      productId: Number(r.product_id),
      name: r.name,
      number: r.card_number,
      setName: r.set_name,
      groupId: Number(r.group_id),
      language: r.language,
      imageUrl: r.image_url,
    })),
  };
}

/**
 * Match a slab to a card you picked. The card's price is read now (the set's
 * live prices) and stored for today, so the comparison shows at once; the daily
 * sync keeps it up to date from then on. If the price can't be read right now,
 * it appears after the next sync.
 */
export async function chooseRawCard(
  itemId: string,
  productId: number,
): Promise<ActionResult<{ priceStored: boolean }>> {
  if (!UUID_RE.test(itemId)) return { ok: false, error: "Invalid item" };
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, error: "Invalid card" };
  const found = await db.execute<{ group_id: string | number }>(sql`
    SELECT group_id FROM catalog_products WHERE product_id = ${productId} AND kind = 'card'
  `);
  const card = Array.from(found)[0];
  if (!card) return { ok: false, error: "That card isn't in the catalogue." };

  const rows = await db
    .update(items)
    .set({ rawCardProductId: productId, rawCardSkipped: false })
    .where(eq(items.id, itemId))
    .returning({ id: items.id });
  if (rows.length === 0) return { ok: false, error: "Item not found" };

  // The card's set becomes a tag on the slab (once, if there is room).
  const setTag = await setTagOfProduct(productId);
  if (setTag) {
    await db.execute(sql`
      UPDATE items SET tags = array_append(tags, ${setTag})
       WHERE id = ${itemId}::uuid AND NOT (${setTag} = ANY(tags)) AND cardinality(tags) < ${MAX_TAGS_PER_ITEM}
    `);
  }

  let priceStored = false;
  try {
    const detail = await getSetDetail(Number(card.group_id));
    const live = detail?.source === "live" ? detail.cards.find((c) => c.productId === productId) : null;
    if (live) {
      const today = new Date().toISOString().slice(0, 10);
      await db.execute(sql`
        INSERT INTO catalog_prices (product_id, day, market_cents)
        VALUES (${productId}, ${today}::date, ${live.marketCents})
        ON CONFLICT (product_id, day) DO UPDATE SET market_cents = EXCLUDED.market_cents
      `);
      priceStored = true;
    }
  } catch {
    // The match is saved either way; the daily sync will store the price.
  }
  revalidatePath("/analytics/slabs");
  return { ok: true, data: { priceStored } };
}
