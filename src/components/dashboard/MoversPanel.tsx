import { ItemLink } from "@/components/ItemDrawer";
import { Card } from "@/components/ui";
import { ItemThumb } from "@/components/ItemThumb";
import type { PricedPosition } from "@/lib/server/price_analytics";

/**
 * "What's moving?" — the biggest recent price changes among what you hold.
 *
 * These are changes in eBay ASKING prices, which are noisy for one-off
 * items (graded slabs especially: two listings of the same card can sit
 * 30% apart). The subtitle says so, because a -39% on a single slab is a
 * reason to look, not a verdict.
 */
export function MoversPanel({
  gainers,
  losers,
  windowDays,
}: {
  gainers: PricedPosition[];
  losers: PricedPosition[];
  windowDays: number;
}) {
  const empty = gainers.length === 0 && losers.length === 0;

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200/80 dark:border-zinc-800">
        <h2 className="font-medium text-sm">
          Biggest moves{" "}
          <span className="text-xs text-zinc-500 font-normal">
            last ~{windowDays}d · asking prices
          </span>
        </h2>
      </div>

      {empty ? (
        <div className="px-4 py-8 text-sm text-zinc-500">
          Not enough price history yet. Moves appear once an item has been
          priced on two different days.
        </div>
      ) : (
        <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
          <Group label="Up" rows={gainers.slice(0, 4)} tone="up" />
          <Group label="Down" rows={losers.slice(0, 4)} tone="down" />
        </div>
      )}
    </Card>
  );
}

function Group({
  label,
  rows,
  tone,
}: {
  label: string;
  rows: PricedPosition[];
  tone: "up" | "down";
}) {
  if (rows.length === 0) return null;
  const color =
    tone === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  return (
    <div>
      <div className="px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </div>
      <ul>
        {rows.map((p) => (
          <li key={p.itemId}>
            <ItemLink
              itemId={p.itemId}
              className="flex items-center gap-2.5 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <ItemThumb imageUrl={p.imageUrl} name={p.name} size={24} />
              <span className="text-sm truncate flex-1 min-w-0">{p.name}</span>
              <span className="text-right tabular-nums shrink-0">
                <span className={`text-sm font-medium ${color}`}>
                  {p.change!.changePct > 0 ? "+" : "−"}
                  {Math.abs(p.change!.changePct * 100).toFixed(1)}%
                </span>
                <span className="block text-[10px] text-zinc-500">
                  over {Math.round(p.change!.spanDays)}d
                </span>
              </span>
            </ItemLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
