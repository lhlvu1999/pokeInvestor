"use server";

import { MAX_TAGS_PER_ITEM } from "@/lib/calc/set_tags";
import { setTagOfProduct } from "./set_tags";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { catalogProducts, items } from "@/db/schema";
import type { ActionResult } from "./items";

const schema = z.object({
  links: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        /** A product to link, or null. */
        productId: z.number().int().positive().nullable(),
        /** With productId null: true = "not in the catalogue", false = unlink. */
        skip: z.boolean().default(false),
      }),
    )
    .min(1, "Nothing to save.")
    .max(500),
});

/**
 * Save the choices from the link screen. A product can only be linked if it
 * exists and is a sealed product; an item can't appear twice. All or nothing.
 */
export async function saveCatalogLinks(
  input: z.input<typeof schema>,
): Promise<
  ActionResult<{ linked: number; skipped: number; unlinked: number }>
> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const { links } = parsed.data;
  if (new Set(links.map((l) => l.itemId)).size !== links.length) {
    return { ok: false, error: "An item appears twice." };
  }

  const productIds = Array.from(
    new Set(links.flatMap((l) => (l.productId == null ? [] : [l.productId]))),
  );
  const imageOf = new Map<number, string | null>();
  if (productIds.length > 0) {
    const ok = await db
      .select({
        id: catalogProducts.productId,
        image: catalogProducts.imageUrl,
      })
      .from(catalogProducts)
      .where(
        and(
          inArray(catalogProducts.productId, productIds),
          eq(catalogProducts.kind, "sealed"),
        ),
      );
    for (const r of ok) imageOf.set(r.id, r.image);
    const bad = productIds.find((id) => !imageOf.has(id));
    if (bad != null) {
      return {
        ok: false,
        error: "One of those products isn't a sealed catalogue product.",
      };
    }
  }

  const known = await db
    .select({ id: items.id })
    .from(items)
    .where(
      inArray(
        items.id,
        links.map((l) => l.itemId),
      ),
    );
  if (known.length !== links.length) {
    return { ok: false, error: "An item no longer exists." };
  }

  let linked = 0;
  // Each linked item also gets its set's name as a tag (once, if there is room).
  const tagOf = new Map<number, string | null>();
  for (const id of productIds) tagOf.set(id, await setTagOfProduct(id));
  let skipped = 0;
  let unlinked = 0;
  await db.transaction(async (tx) => {
    for (const l of links) {
      if (l.productId != null) {
        const image = imageOf.get(l.productId) ?? null;
        const setTag = tagOf.get(l.productId) ?? null;
        await tx
          .update(items)
          .set({
            catalogProductId: l.productId,
            catalogLinkSkipped: false,
            // The person decided, so the daily sync will never touch it.
            catalogLinkSource: "manual",
            // An image the item already has is kept; a missing one is filled.
            imageUrl: sql`CASE WHEN COALESCE(${items.imageUrl}, '') = '' THEN ${image} ELSE ${items.imageUrl} END`,
            ...(setTag
              ? {
                  tags: sql`CASE WHEN ${setTag} = ANY(${items.tags}) OR cardinality(${items.tags}) >= ${MAX_TAGS_PER_ITEM} THEN ${items.tags} ELSE array_append(${items.tags}, ${setTag}) END`,
                }
              : {}),
          })
          .where(eq(items.id, l.itemId));
        linked += 1;
      } else if (l.skip) {
        await tx
          .update(items)
          .set({
            catalogProductId: null,
            catalogLinkSkipped: true,
            catalogLinkSource: "manual",
          })
          .where(eq(items.id, l.itemId));
        skipped += 1;
      } else {
        // Removing a link (or asking to be shown suggestions again). Marked
        // 'declined' so the daily sync doesn't just link it back.
        await tx
          .update(items)
          .set({
            catalogProductId: null,
            catalogLinkSkipped: false,
            catalogLinkSource: "declined",
          })
          .where(eq(items.id, l.itemId));
        unlinked += 1;
      }
    }
  });

  revalidatePath("/catalog/links");
  revalidatePath("/items");
  for (const l of links) revalidatePath(`/items/${l.itemId}`);
  return { ok: true, data: { linked, skipped, unlinked } };
}
