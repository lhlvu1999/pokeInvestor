/**
 * Loader for the share-snapshot page. A pure read (no "use server").
 *
 * This is the only place the page gets cost basis from. It stays in the
 * browser of the person who owns the data; what is actually shared is
 * decided by `buildSnapshot`, which copies in only the fields chosen.
 */

import type { ShareLine } from "@/lib/calc/share_snapshot";
import type { CurrencyCode } from "@/lib/currency";
import { getDashboardData } from "@/lib/server/portfolio";

export async function getShareLines(displayCurrency: CurrencyCode): Promise<{
  lines: ShareLine[];
  tags: string[];
  /** Held items left out because no exchange rate was available. */
  skipped: number;
}> {
  const { items, converted } = await getDashboardData(displayCurrency);
  const lines: ShareLine[] = [];
  let skipped = 0;
  items.forEach(({ item, valuation }, i) => {
    if (valuation.quantity <= 0) return;
    const conv = converted[i];
    // No rate: the item is zeroed out of every total, so it can't be shown
    // in this currency honestly.
    if (conv.quantity <= 0) {
      skipped += 1;
      return;
    }
    lines.push({
      itemId: item.id,
      name: item.name,
      tags: item.tags,
      quantity: conv.quantity,
      marketUnit: conv.hasPrice
        ? Math.round(conv.marketValue / conv.quantity)
        : null,
      avgCost: Math.round(conv.inventoryCost / conv.quantity),
    });
  });
  const tags = Array.from(new Set(lines.flatMap((l) => l.tags))).sort();
  return { lines, tags, skipped };
}
