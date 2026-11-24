/**
 * Held items whose market price has reached their sell target. A pure read
 * (no "use server"), feeding the dashboard's "worth a look" queue.
 */

import { sellTargetStanding } from "@/lib/calc/sell_target";
import { listItemsWithValuations } from "@/lib/server/items";

export type SellTargetHit = {
  itemId: string;
  name: string;
  held: number;
  /** How far above the target the price is (0.1 = 10% above). */
  aboveBy: number;
};

export async function getSellTargetHits(): Promise<SellTargetHit[]> {
  const all = await listItemsWithValuations();
  const hits: SellTargetHit[] = [];
  for (const { item, valuation, latestPrice } of all) {
    if (valuation.quantity <= 0) continue;
    const s = sellTargetStanding({
      targetCents: item.sellTargetCents,
      targetCurrency: item.sellTargetCurrency,
      priceCents: latestPrice?.priceCents ?? null,
      priceCurrency: latestPrice?.currency ?? null,
    });
    if (s.state === "reached") {
      hits.push({
        itemId: item.id,
        name: item.name,
        held: valuation.quantity,
        aboveBy: s.aboveBy,
      });
    }
  }
  return hits.sort((a, b) => b.aboveBy - a.aboveBy);
}
