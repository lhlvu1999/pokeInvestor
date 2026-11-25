import Link from "next/link";
import { ItemThumb } from "@/components/ItemThumb";
import { Money } from "@/components/Money";
import { Card } from "@/components/ui";
import type { SetHoldingItem } from "@/lib/calc/set_holdings";
import type { ItemSetLink, SetHoldings } from "@/lib/server/set_holdings";

function Figure({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums leading-tight">{children}</div>
      {hint && <div className="text-[11px] text-zinc-500 truncate">{hint}</div>}
    </div>
  );
}

function Figures({ h }: { h: SetHoldings }) {
  const pricedCost = h.cost - h.unpricedCost;
  const change = pricedCost > 0 ? h.value / pricedCost - 1 : null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
      <Figure label="Items held" hint={h.soldOut > 0 ? `${h.soldOut} more sold out` : undefined}>
        {h.held.length}
      </Figure>
      <Figure label="Units">{h.units}</Figure>
      <Figure
        label="Worth now"
        hint={h.unpriced > 0 ? `${h.unpriced} unpriced left out` : "At market price"}
      >
        <Money amount={h.value} currency={h.currency} />
      </Figure>
      <Figure
        label="Paid"
        hint={
          change != null
            ? `${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(1)}% on the priced ones`
            : undefined
        }
      >
        <Money amount={h.cost} currency={h.currency} />
      </Figure>
    </div>
  );
}


const SHOWN_ITEMS = 5;

function HoldingRow({ it, currency }: { it: SetHoldingItem; currency: string }) {
  return (
      <li className="py-2.5">
        <Link href={`/items/${it.id}`} className="flex items-center gap-3 group">
          <ItemThumb imageUrl={it.imageUrl} name={it.name} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium group-hover:underline">{it.name}</span>
            <span className="block text-[11px] text-zinc-500">
              {it.units} unit{it.units === 1 ? "" : "s"}
              {it.shareOfValue != null ? ` · ${Math.round(it.shareOfValue * 100)}% of the value` : " · no price yet"}
            </span>
          </span>
          <span className="shrink-0 text-sm tabular-nums">
            {it.hasPrice ? (
              <Money amount={it.value} currency={currency} />
            ) : (
              <span className="text-zinc-500">
                <Money amount={it.cost} currency={currency} /> cost
              </span>
            )}
          </span>
        </Link>
        {it.shareOfValue != null && (
          <div className="mt-1.5 ml-[48px] h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-sky-500/80"
              style={{ width: `${Math.max(2, it.shareOfValue * 100)}%` }}
            />
          </div>
        )}
      </li>
  );
}

/**
 * What you hold in one set. `compact` is the strip on an item page, with a button
 * through to the set's analytics; the full version, on the set page, also lists the
 * items.
 */
export function SetHoldingsCard({
  set,
  holdings,
  currentItemId,
  compact = false,
}: {
  set: ItemSetLink;
  holdings: SetHoldings;
  /** The item page being viewed, so its own share can be called out. */
  currentItemId?: string;
  compact?: boolean;
}) {
  const me = currentItemId ? holdings.held.find((h) => h.id === currentItemId) : undefined;
  const none = holdings.held.length === 0;

  if (compact) {
    return (
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
              Its set
            </div>
            <div className="font-medium">
              {set.name}{" "}
              <span className="text-xs text-zinc-500 font-normal">
                {set.language === "ja" ? "Japanese" : "English"}
              </span>
            </div>
          </div>
          <Link
            href={`/catalog/sets/${set.groupId}`}
            className="inline-flex items-center rounded-md border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 h-8 text-xs font-medium text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/60"
          >
            Open set analytics →
          </Link>
        </div>
        {none ? (
          <p className="mt-3 text-sm text-zinc-500">You hold nothing from this set right now.</p>
        ) : (
          <>
            <div className="mt-3">
              <Figures h={holdings} />
            </div>
            {me && me.shareOfValue != null && holdings.held.length > 1 && (
              <p className="mt-3 text-xs text-zinc-500">
                This item is {Math.round(me.shareOfValue * 100)}% of what you hold in this set, at market value.
              </p>
            )}
          </>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h2 className="font-medium">Your holdings in this set</h2>
      {none ? (
        <p className="mt-2 text-sm text-zinc-500">
          You hold nothing from this set right now
          {holdings.soldOut > 0 ? ` (${holdings.soldOut} linked item${holdings.soldOut === 1 ? "" : "s"} sold out)` : ""}.
        </p>
      ) : (
        <>
          <div className="mt-3">
            <Figures h={holdings} />
          </div>
          <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800 border-t border-zinc-200 dark:border-zinc-800">
            {holdings.held.slice(0, SHOWN_ITEMS).map((it) => (
              <HoldingRow key={it.id} it={it} currency={holdings.currency} />
            ))}
          </ul>
          {holdings.held.length > SHOWN_ITEMS && (
            <details className="border-t border-zinc-200 dark:border-zinc-800">
              <summary className="py-2.5 text-xs text-sky-700 dark:text-sky-400 cursor-pointer select-none hover:underline">
                Show the other {holdings.held.length - SHOWN_ITEMS} item
                {holdings.held.length - SHOWN_ITEMS === 1 ? "" : "s"}
              </summary>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 border-t border-zinc-200 dark:border-zinc-800">
                {holdings.held.slice(SHOWN_ITEMS).map((it) => (
                  <HoldingRow key={it.id} it={it} currency={holdings.currency} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}
