export const dynamic = "force-dynamic";

import Link from "next/link";
import { getSetsList } from "@/lib/server/catalog_sets";
import { getDisplayCurrency } from "@/lib/server/settings";
import { getUsdFx } from "@/lib/server/catalog_fx";
import { describeFx } from "@/lib/calc/catalog_money";
import { Card } from "@/components/ui";
import { SetsTable } from "./SetsTable";

/**
 * Every English and Japanese Pokémon set with its latest value: the whole
 * set (one of each card), its top 20, and how many sealed products it has.
 * Open a set for the full, live card list.
 */
export default async function CatalogPage() {
  const currency = await getDisplayCurrency();
  const [{ rows, asOf }, fx] = await Promise.all([
    getSetsList(),
    getUsdFx(currency),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sets</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          Every English and Japanese Pokémon set with TCGplayer prices, shown in
          your currency. <strong>Set value</strong> is one of each card at its
          best printing; <strong>Top 20</strong> is its twenty most valuable
          cards. Open a set to see every card, fetched live.
        </p>
      </div>

      {rows.length === 0 || !asOf ? (
        <Card className="p-6 text-sm">
          <div className="font-medium">The catalogue is empty</div>
          <p className="mt-1 text-zinc-600 dark:text-zinc-300 max-w-prose">
            Run the sync once to fill it:
          </p>
          <pre className="mt-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3 text-xs overflow-x-auto">
            cd pipeline && uv run poke-pipeline catalog-sync
          </pre>
        </Card>
      ) : (
        <>
          <p className="text-xs text-zinc-500">
            Prices as of {asOf}, updated daily.{" "}
            <Link
              href="/catalog/links"
              className="underline hover:no-underline"
            >
              Link your items to the catalogue
            </Link>{" "}
            to see which sets you hold, or see{" "}
            <Link
              href="/catalog/insights"
              className="underline hover:no-underline"
            >
              how the market has moved
            </Link>
            , or{" "}
            <Link
              href="/catalog/compare"
              className="underline hover:no-underline"
            >
              compare sets
            </Link>
            .
          </p>
          <SetsTable rows={rows} fx={fx} />
          <p className="text-xs text-zinc-500 max-w-prose">
            {describeFx(fx, currency)}
          </p>
        </>
      )}
    </div>
  );
}
