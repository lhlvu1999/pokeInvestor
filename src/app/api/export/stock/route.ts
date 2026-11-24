import { NextRequest } from "next/server";
import { endOfDay, isDay, stockCsv } from "@/lib/calc/stock_on";
import { minorToDecimalString } from "@/lib/currency";
import { getStockOn } from "@/lib/server/stock_on";
import { getDisplayCurrency } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

/** What was held at the end of a day (`?date=2026-12-31`), as CSV. */
export async function GET(req: NextRequest) {
  const day = req.nextUrl.searchParams.get("date") ?? "";
  if (!isDay(day)) {
    return new Response("date must look like 2026-12-31", { status: 400 });
  }
  const lines = await getStockOn(endOfDay(day), await getDisplayCurrency());
  return new Response(stockCsv(day, lines, minorToDecimalString), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="poke-investor-stock-${day}.csv"`,
    },
  });
}
