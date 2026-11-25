/**
 * Held items whose market price is at or below their price floor. A pure read
 * (no "use server"), feeding the dashboard's "needs attention" queue.
 */

import { floorStanding } from "@/lib/calc/price_floor";
import { listItemsWithValuations } from "@/lib/server/items";

export type PriceFloorHit = {
  itemId: string;
  name: string;
  held: number;
  /** How far below the floor the price is (0.1 = 10% below). */
  belowBy: number;
};

export async function getPriceFloorHits(): Promise<PriceFloorHit[]> {
  const all = await listItemsWithValuations();
  const hits: PriceFloorHit[] = [];
  for (const { item, valuation, latestPrice } of all) {
    if (valuation.quantity <= 0) continue;
    const s = floorStanding({
      floorCents: item.floorCents,
      floorCurrency: item.floorCurrency,
      priceCents: latestPrice?.priceCents ?? null,
      priceCurrency: latestPrice?.currency ?? null,
    });
    if (s.state === "reached") {
      hits.push({ itemId: item.id, name: item.name, held: valuation.quantity, belowBy: s.belowBy });
    }
  }
  return hits.sort((a, b) => b.belowBy - a.belowBy);
}
