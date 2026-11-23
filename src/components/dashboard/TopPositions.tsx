import { ItemLink } from "@/components/ItemDrawer";
import Link from "next/link";
import { Card } from "@/components/ui";
import { ItemThumb } from "@/components/ItemThumb";
import { Money } from "@/components/Money";
import type { ConvertedItemValues } from "@/lib/calc/portfolio";
import type { ItemWithValuation } from "@/lib/server/items";

type Row = {
  id: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  /** Market value when priced, otherwise cost — see `priced`. */
  value: number;
  priced: boolean;
  /** Market ÷ cost − 1. Null when unpriced or cost is zero. */
  returnPct: number | null;
};

/**
 * "What do I hold?" — the largest positions, biggest first.
 *
 * Ranked by market value where we have a price and by cost where we don't,
 * so a large unpriced position still shows up (flagged "at cost") instead
 * of vanishing from the list just because it hasn't been priced.
 */
export function TopPositions({
  items,
  converted,
  currency,
  // 8 rows lines this card up with the movers panel beside it (4 up + 4 down).
  limit = 8,
}: {
  items: ItemWithValuation[];
  converted: ConvertedItemValues[];
  currency: string;
  limit?: number;
}) {
  const held: Row[] = [];
  items.forEach(({ item, valuation }, i) => {
    if (valuation.quantity <= 0) return;
    const conv = converted[i];
    const priced = conv.hasPrice;
    held.push({
      id: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      quantity: valuation.quantity,
      value: priced ? conv.marketValue : conv.inventoryCost,
      priced,
      returnPct:
        priced && conv.inventoryCost > 0
          ? conv.marketValue / conv.inventoryCost - 1
          : null,
    });
  });
  held.sort((a, b) => b.value - a.value);
  const rows = held.slice(0, limit);

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-2">
        <h2 className="font-medium text-sm">
          Top positions{" "}
          <span className="text-xs text-zinc-500 font-normal">
            by value · {held.length} held
          </span>
        </h2>
        <Link
          href="/items?status=in-stock"
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          View all →
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-sm text-zinc-500">
          Nothing in stock right now.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
          {rows.map((r) => (
            <li key={r.id}>
              <ItemLink
                itemId={r.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <ItemThumb imageUrl={r.imageUrl} name={r.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-[11px] text-zinc-500">
                    {r.quantity} held
                  </div>
                </div>
                <div className="text-right tabular-nums shrink-0">
                  <div className="text-sm font-medium">
                    <Money amount={r.value} currency={currency} />
                  </div>
                  <div className="text-[11px]">
                    {r.returnPct != null ? (
                      <span
                        className={
                          r.returnPct > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : r.returnPct < 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-zinc-500"
                        }
                      >
                        {r.returnPct > 0 ? "+" : r.returnPct < 0 ? "−" : ""}
                        {Math.abs(r.returnPct * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-zinc-400">
                        {r.priced ? "—" : "at cost · unpriced"}
                      </span>
                    )}
                  </div>
                </div>
              </ItemLink>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
