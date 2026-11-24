export const dynamic = "force-dynamic";

import Link from "next/link";
import { getCountRows } from "@/lib/server/stock_count";
import { getDisplayCurrency } from "@/lib/server/settings";
import { StockCount } from "./StockCount";

/**
 * Stock count: reconcile the shelf against the ledger. Only received units
 * are counted; anything still in the post is left out on purpose.
 */
export default async function StockCountPage() {
  const currency = await getDisplayCurrency();
  const rows = await getCountRows(currency);

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div>
        <Link href="/items" className="text-sm text-zinc-500 hover:underline">
          ← Items
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Stock count
        </h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose">
          Count what is physically on the shelf and enter it beside what the
          ledger says. Units still on the way aren&apos;t included. Anything
          missing can be recorded as lost; anything extra needs a purchase
          logged, because its cost isn&apos;t known.
        </p>
      </div>
      <StockCount rows={rows} currency={currency} />
    </div>
  );
}
