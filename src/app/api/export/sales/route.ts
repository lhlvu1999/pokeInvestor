import { NextRequest } from "next/server";
import { linesOfYear, salesCsv, yearOf } from "@/lib/calc/annual";
import { minorToDecimalString } from "@/lib/currency";
import { getSaleLines } from "@/lib/server/annual";
import { getDisplayCurrency } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

/** Sales ledger as CSV, for one calendar year (`?year=2026`) or all of them. */
export async function GET(req: NextRequest) {
  const lines = await getSaleLines(await getDisplayCurrency());
  const raw = req.nextUrl.searchParams.get("year");
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
  if (raw && year == null) {
    return new Response("year must look like 2026", { status: 400 });
  }
  const picked =
    year == null
      ? [...lines].sort((a, b) => a.soldOn.getTime() - b.soldOn.getTime())
      : linesOfYear(lines, year);
  if (year != null && !lines.some((l) => yearOf(l.soldOn) === year)) {
    return new Response(`No sales in ${year}`, { status: 404 });
  }
  return new Response(salesCsv(picked, minorToDecimalString), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="poke-investor-sales-${year ?? "all"}.csv"`,
    },
  });
}
