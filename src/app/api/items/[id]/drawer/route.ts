import { NextResponse } from "next/server";
import { getItemDrawerData } from "@/lib/server/item_drawer";

// Always read live data: prices and holdings change under the user.
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/items/:id/drawer
 *
 * Read-only summary for the item drawer: valuation, price history and the
 * trades to plot on it, in the display currency.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Reject non-UUIDs up front: the column is a uuid and Postgres would
  // otherwise throw on a malformed value and surface as a 500.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
  }
  try {
    const data = await getItemDrawerData(id);
    if (!data) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load item" },
      { status: 500 },
    );
  }
}
