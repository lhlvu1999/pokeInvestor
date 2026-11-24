import { NextResponse } from "next/server";
import { isChangeWindow } from "@/lib/calc/changes";
import { getChanges } from "@/lib/server/changes";
import { getDisplayCurrency } from "@/lib/server/settings";

// Prices and transactions change under the user: always read live.
export const dynamic = "force-dynamic";

/**
 * GET /api/changes?window=day|week
 *
 * Read-only summary of what moved in the window, for the dashboard's
 * "What changed" panel.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("window") ?? "week";
  if (!isChangeWindow(raw)) {
    return NextResponse.json(
      { error: "window must be 'day' or 'week'" },
      { status: 400 },
    );
  }
  try {
    const currency = await getDisplayCurrency();
    return NextResponse.json(await getChanges(raw, currency));
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load changes",
      },
      { status: 500 },
    );
  }
}
