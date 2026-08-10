import Link from "next/link";
import { Card } from "@/components/ui";
import { ItemThumb } from "@/components/ItemThumb";
import { Money } from "@/components/Money";
import type { SellCandidate } from "@/lib/server/sell_scorecard";

/**
 * Sell-scorecard — ranked held items where the data says "consider
 * selling." Combines bearish creator sentiment, hold time, and portfolio
 * concentration into a single 0–1 score. No market prices required.
 */
export function SellScorecard({
  candidates,
  currency,
}: {
  candidates: SellCandidate[];
  currency: string;
}) {
  if (candidates.length === 0) {
    return (
      <Card className="p-4 text-sm text-zinc-500">
        Nothing rising to a sell signal. Held items with only bullish sentiment
        and short hold time stay off this list.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Item</th>
              <th className="px-4 py-2 text-right font-medium">Held</th>
              <th className="px-4 py-2 text-right font-medium">Stock value</th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="Months since your first buy"
              >
                Held for
              </th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="Bullish / neutral / bearish mentions in the window"
              >
                Sentiment
              </th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="Item's share of total inventory value"
              >
                Concentration
              </th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="Composite: 0.6 × bearish + 0.3 × hold + 0.1 × concentration"
              >
                Score
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {candidates.map((c) => {
              const scorePct = (c.score * 100).toFixed(0);
              const scoreColor =
                c.score > 0.6
                  ? "text-rose-600 dark:text-rose-400"
                  : c.score > 0.35
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-zinc-500";
              return (
                <tr
                  key={c.itemId}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <ItemThumb
                        imageUrl={c.imageUrl}
                        name={c.name}
                        size={28}
                      />
                      <Link
                        href={`/items/${c.itemId}`}
                        className="font-medium hover:underline truncate"
                      >
                        {c.name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.quantity}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <Money amount={c.inventoryCost} currency={currency} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">
                    {c.holdMonths < 1
                      ? "<1 mo"
                      : `${c.holdMonths.toFixed(0)} mo`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                    {c.bullish + c.neutral + c.bearish === 0 ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <>
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {c.bullish}
                        </span>
                        <span className="text-zinc-400"> / </span>
                        <span className="text-zinc-500">{c.neutral}</span>
                        <span className="text-zinc-400"> / </span>
                        <span className="text-rose-600 dark:text-rose-400">
                          {c.bearish}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">
                    {c.concentrationPct.toFixed(1)}%
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums font-semibold ${scoreColor}`}
                  >
                    {scorePct}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
