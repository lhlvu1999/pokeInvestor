export const dynamic = "force-dynamic";

import Link from "next/link";
import { getLinkReview } from "@/lib/server/catalog_links";
import { Card } from "@/components/ui";
import { LinkReview } from "./LinkReview";

/**
 * Link each item to the catalogue product it is, so it can be priced from
 * TCGplayer data. Suggestions only: confident ones are pre-ticked, anything
 * uncertain waits for a choice, and nothing is saved until you press Save.
 */
export default async function CatalogLinksPage() {
  const review = await getLinkReview();
  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <div>
        <Link href="/items" className="text-sm text-zinc-500 hover:underline">
          ← Items
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Link items to the catalogue
        </h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          The catalogue lists every English and Japanese Pokémon set and its
          sealed products with daily TCGplayer prices. Linking an item to its
          product lets the app show that price beside your eBay one. These are
          suggestions: check each before saving.
        </p>
      </div>

      {!review.catalogReady ? (
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
        <LinkReview
          rows={review.rows}
          sealedProducts={review.sealedProducts}
          pricesAsOf={review.pricesAsOf?.toISOString() ?? null}
        />
      )}
    </div>
  );
}
