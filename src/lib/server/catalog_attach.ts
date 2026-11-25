/**
 * Tie a freshly created item to the catalogue. A plain module (not "use server"),
 * called by `createItem`.
 *
 * - A sealed product goes in `catalog_product_id`; a card goes in
 *   `raw_card_product_id` (what a graded slab already uses), so the sealed-product
 *   analysis is never affected by a card.
 * - The item gets its set's tag, as the "Link items" screen does, and a missing
 *   picture is filled from the catalogue.
 * - `source` records who decided: 'manual' = the person picked it, 'auto' = it was
 *   a single clear match, so the daily sync leaves it alone either way.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import { MAX_TAGS_PER_ITEM } from "@/lib/calc/set_tags";
import { matchItem, prepareCatalog } from "@/lib/calc/catalog_match";
import { loadSealedCandidates } from "./catalog_candidates";
import { setTagOfProduct } from "./set_tags";

export type LinkSummary = {
  productId: number;
  productName: string;
  setName: string;
  kind: "sealed" | "card";
  how: "picked" | "auto";
};

type ProductRow = {
  product_id: string | number;
  name: string;
  kind: string;
  image_url: string | null;
  set_name: string;
};

async function loadProduct(productId: number): Promise<ProductRow | null> {
  const rows = await db.execute<ProductRow>(sql`
    SELECT p.product_id, p.name, p.kind, p.image_url, s.name AS set_name
      FROM catalog_products p JOIN catalog_sets s ON s.group_id = p.group_id
     WHERE p.product_id = ${productId}
  `);
  return Array.from(rows)[0] ?? null;
}

export async function attachCatalogProduct(
  itemId: string,
  productId: number,
  how: "picked" | "auto",
): Promise<LinkSummary | null> {
  const product = await loadProduct(productId);
  if (!product) return null;
  const kind = product.kind === "sealed" ? "sealed" : "card";
  const setTag = await setTagOfProduct(productId);
  await db
    .update(items)
    .set({
      ...(kind === "sealed"
        ? { catalogProductId: productId, catalogLinkSkipped: false }
        : { rawCardProductId: productId, rawCardSkipped: false }),
      ...(kind === "sealed"
        ? { catalogLinkSource: how === "picked" ? "manual" : "auto" }
        : {}),
      imageUrl: sql`CASE WHEN COALESCE(${items.imageUrl}, '') = '' THEN ${product.image_url} ELSE ${items.imageUrl} END`,
      ...(setTag
        ? {
            tags: sql`CASE WHEN ${setTag} = ANY(${items.tags}) OR cardinality(${items.tags}) >= ${MAX_TAGS_PER_ITEM} THEN ${items.tags} ELSE array_append(${items.tags}, ${setTag}) END`,
          }
        : {}),
    })
    .where(eq(items.id, itemId));
  return {
    productId,
    productName: product.name,
    setName: product.set_name,
    kind,
    how,
  };
}

/**
 * The one sealed product this name clearly is, or null. Same rule the daily sync
 * applies ("confident": a single clear best match), so a wrong link stays rare.
 */
export async function findConfidentSealed(
  name: string,
  tags: string[] = [],
): Promise<number | null> {
  const result = matchItem({ name, tags }, prepareCatalog(await loadSealedCandidates()));
  const best = result.options[0];
  return result.status === "confident" && best ? best.candidate.productId : null;
}
