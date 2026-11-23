export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { getCurrencyMeta } from "@/lib/currency";
import { listItemsWithValuations } from "@/lib/server/items";
import { getDisplayCurrency } from "@/lib/server/settings";
import { OfferBuilder, type OfferRow } from "./OfferBuilder";

/**
 * Offer sheet: pick held items, price them at a percentage of market, and
 * hand the buyer a clean list. Only items that are in stock AND have a
 * market price can be offered — without a price there is nothing to take a
 * percentage of — and the page says how many were left out and why.
 */
export default async function OfferPage() {
  const [all, displayCurrency] = await Promise.all([
    listItemsWithValuations(),
    getDisplayCurrency(),
  ]);

  const now = new Date();
  const rows: OfferRow[] = [];
  let unpriced = 0;
  let otherCurrency = 0;
  for (const { item, valuation, latestPrice } of all) {
    if (valuation.quantity <= 0) continue;
    if (!latestPrice || latestPrice.priceCents <= 0) {
      unpriced += 1;
      continue;
    }
    // One sheet is one currency. Amounts are not converted here: the sale
    // is recorded in the item's own currency, so a converted price would
    // not match what ends up in the books.
    if (valuation.currency !== displayCurrency) {
      otherCurrency += 1;
      continue;
    }
    rows.push({
      id: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      held: valuation.quantity,
      marketUnit: latestPrice.priceCents,
      priceAt: latestPrice.fetchedAt.getTime(),
      avgCost: valuation.avgCostCents,
    });
  }
  rows.sort((a, b) => b.marketUnit * b.held - a.marketUnit * a.held);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Offer sheet</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Pick what you want to sell, set a percentage of market, and send the
          buyer a clean list. Your cost and profit stay private.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-zinc-500">
          Nothing to offer yet. An item needs to be in stock and have a market
          price — use <strong>Update prices</strong> on the Items page.
        </Card>
      ) : (
        <OfferBuilder
          rows={rows}
          currency={displayCurrency}
          exponent={getCurrencyMeta(displayCurrency).exponent}
          now={now.getTime()}
          unpricedCount={unpriced}
          otherCurrencyCount={otherCurrency}
        />
      )}
    </div>
  );
}
