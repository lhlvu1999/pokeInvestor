"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { itemImages, items } from "@/db/schema";
import {
  parseImageLink,
  parseUpload,
  uploadedImagePath,
} from "@/lib/calc/item_image";
import type { ActionResult } from "./items";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh(id: string) {
  revalidatePath("/items");
  revalidatePath("/");
  revalidatePath(`/items/${id}`);
}

async function exists(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const [row] = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  return !!row;
}

/** Use a picture from a web link. Replaces any uploaded one. */
export async function setItemImageLink(
  id: string,
  link: string,
): Promise<ActionResult<{ imageUrl: string }>> {
  const parsed = parseImageLink(link);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (!(await exists(id))) return { ok: false, error: "Item not found" };
  await db.transaction(async (tx) => {
    await tx.delete(itemImages).where(eq(itemImages.itemId, id));
    await tx.update(items).set({ imageUrl: parsed.url }).where(eq(items.id, id));
  });
  refresh(id);
  return { ok: true, data: { imageUrl: parsed.url } };
}

/** Keep a picture uploaded from the person's device (already shrunk). */
export async function uploadItemImage(
  id: string,
  dataUrl: string,
): Promise<ActionResult<{ imageUrl: string }>> {
  const parsed = parseUpload(dataUrl);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (!(await exists(id))) return { ok: false, error: "Item not found" };
  const imageUrl = uploadedImagePath(id, Date.now());
  await db.transaction(async (tx) => {
    await tx
      .insert(itemImages)
      .values({
        itemId: id,
        contentType: parsed.contentType,
        dataBase64: parsed.base64,
      })
      .onConflictDoUpdate({
        target: itemImages.itemId,
        set: {
          contentType: parsed.contentType,
          dataBase64: parsed.base64,
          updatedAt: new Date(),
        },
      });
    await tx.update(items).set({ imageUrl }).where(eq(items.id, id));
  });
  refresh(id);
  return { ok: true, data: { imageUrl } };
}

/**
 * Remove the picture. An item linked to a catalogue product gets the
 * catalogue's picture back the next time the daily link step runs.
 */
export async function clearItemImage(id: string): Promise<ActionResult<null>> {
  if (!(await exists(id))) return { ok: false, error: "Item not found" };
  await db.transaction(async (tx) => {
    await tx.delete(itemImages).where(eq(itemImages.itemId, id));
    await tx.update(items).set({ imageUrl: null }).where(eq(items.id, id));
  });
  refresh(id);
  return { ok: true, data: null };
}
