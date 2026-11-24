import { NextResponse } from "next/server";
import { isSupportedCurrency } from "@/lib/currency";
import { getUsdFx } from "@/lib/server/catalog_fx";
import {
  getSetDetail,
  UpstreamUnavailableError,
} from "@/lib/server/catalog_live";
import { getDisplayCurrency } from "@/lib/server/settings";

// Fetched from TCGCSV when asked (and cached for an hour inside the loader).
export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/sets/:groupId
 *
 * One set's detail: totals, every priced card (most valuable first) and the
 * sealed products. `source` says whether it was read live from TCGCSV for
 * this request or is the last daily sync, and `note` explains why when it
 * isn't live. Prices are US cents.
 *
 * `fx` says how to turn those dollars into another currency: `rate` is how many
 * units of `currency` one US dollar buys (the app's display currency, VND by
 * default, or `?currency=EUR` etc.). It is null when no rate is available; the
 * prices themselves are always US cents, never converted here.
 *
 * Only sets in the catalogue can be requested.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId: raw } = await params;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) > 2_147_483_647) {
    return NextResponse.json(
      { error: "groupId must be a whole number" },
      { status: 400 },
    );
  }
  const asked = new URL(req.url).searchParams.get("currency");
  if (asked != null && !isSupportedCurrency(asked.toUpperCase())) {
    return NextResponse.json(
      { error: `Unsupported currency: ${asked}` },
      { status: 400 },
    );
  }
  try {
    const detail = await getSetDetail(Number(raw));
    if (!detail) {
      return NextResponse.json({ error: "Unknown set" }, { status: 404 });
    }
    const currency = asked ? asked.toUpperCase() : await getDisplayCurrency();
    const fx = await getUsdFx(currency);
    return NextResponse.json(
      { ...detail, fx },
      {
        headers: { "Cache-Control": "private, max-age=300" },
      },
    );
  } catch (err) {
    if (err instanceof UpstreamUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load the set" },
      { status: 500 },
    );
  }
}
