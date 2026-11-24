import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { itemImages } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/items/:id/image
 *
 * The picture uploaded for an item. The item's image_url carries a `?v=`
 * stamp that changes with every upload, so it can be cached for good.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Invalid item id", { status: 400 });
  const [row] = await db
    .select({ type: itemImages.contentType, data: itemImages.dataBase64 })
    .from(itemImages)
    .where(eq(itemImages.itemId, id))
    .limit(1);
  if (!row) return new Response("No picture", { status: 404 });
  return new Response(Buffer.from(row.data, "base64"), {
    headers: {
      "Content-Type": row.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
