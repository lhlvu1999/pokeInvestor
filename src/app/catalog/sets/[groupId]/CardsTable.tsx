"use client";

import { useMemo, useState } from "react";
import { Card, Select, TextInput } from "@/components/ui";
import { ItemThumb } from "@/components/ItemThumb";
import type { SetCard } from "@/lib/calc/catalog_set";
import { showUsd, type Fx } from "@/lib/calc/catalog_money";

type Sort = "price" | "number" | "name";

const PAGE = 50;

/** Card numbers like "161/131" or "SV-P 049" sort by their first number. */
function numberKey(n: string | null): number {
  const m = /\d+/.exec(n ?? "");
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
}

/** Search, filter by rarity, and re-sort a set's cards. */
export function CardsTable({
  cards,
  truncated,
  pricedTotal,
  stored,
  fx,
}: {
  cards: SetCard[];
  truncated: boolean;
  pricedTotal: number;
  stored: boolean;
  fx: Fx | null;
}) {
  const [text, setText] = useState("");
  const [rarity, setRarity] = useState("");
  const [sort, setSort] = useState<Sort>("price");
  const [shown, setShown] = useState(PAGE);

  const rarities = useMemo(
    () =>
      Array.from(
        new Set(cards.map((c) => c.rarity).filter((r): r is string => !!r)),
      ).sort(),
    [cards],
  );

  const result = useMemo(() => {
    const term = text.trim().toLowerCase();
    const out = cards.filter(
      (c) =>
        (!rarity || c.rarity === rarity) &&
        (!term || `${c.name} ${c.number ?? ""}`.toLowerCase().includes(term)),
    );
    out.sort((a, b) => {
      const c =
        sort === "price"
          ? b.marketCents - a.marketCents
          : sort === "number"
            ? numberKey(a.number) - numberKey(b.number)
            : a.name.localeCompare(b.name);
      return c || a.productId - b.productId;
    });
    return out;
  }, [cards, text, rarity, sort]);

  const visible = result.slice(0, shown);
  const back = () => setShown(PAGE);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          type="search"
          placeholder="Search cards…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            back();
          }}
          className="min-w-0 flex-1 sm:flex-none sm:w-64"
        />
        {rarities.length > 1 && (
          <Select
            value={rarity}
            onChange={(e) => {
              setRarity(e.target.value);
              back();
            }}
            aria-label="Rarity"
          >
            <option value="">All rarities</option>
            {rarities.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        )}
        <Select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as Sort);
            back();
          }}
          aria-label="Sort by"
        >
          <option value="price">Highest price</option>
          <option value="number">Card number</option>
          <option value="name">Name A–Z</option>
        </Select>
        <span className="text-xs text-zinc-500 sm:ml-auto">
          {result.length === cards.length
            ? `${cards.length} cards`
            : `${result.length} of ${cards.length} cards`}
        </span>
      </div>

      {(truncated || stored) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {stored
            ? `Only the top ${cards.length} cards are saved. Open this set when TCGCSV is reachable to see all ${pricedTotal}.`
            : `Showing the ${cards.length} most valuable of ${pricedTotal} priced cards. The set value above counts all of them.`}
        </p>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Card</th>
              <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">
                Rarity
              </th>
              <th className="px-3 py-2 text-left font-medium hidden md:table-cell">
                Printing
              </th>
              <th className="px-4 py-2 text-right font-medium">Market</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visible.map((c) => (
              <tr key={c.productId}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <ItemThumb imageUrl={c.imageUrl} name={c.name} size={36} />
                    <div className="min-w-0">
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                      <div className="text-xs text-zinc-500 sm:hidden">
                        {[c.rarity, c.variant].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-zinc-500 hidden sm:table-cell">
                  {c.rarity ?? "—"}
                </td>
                <td className="px-3 py-2 text-zinc-500 hidden md:table-cell">
                  {c.variant ?? "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap">
                  <Price cents={c.marketCents} fx={fx} />
                </td>
              </tr>
            ))}
            {result.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  No cards match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {result.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="self-center rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 h-10 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Show {Math.min(PAGE, result.length - shown)} more (
          {result.length - shown} left)
        </button>
      )}
    </div>
  );
}

/** The converted price with the dollars underneath. */
function Price({ cents, fx }: { cents: number; fx: Fx | null }) {
  const shown = showUsd(cents, fx);
  return (
    <>
      {shown.primary}
      {shown.secondary && (
        <div className="text-[11px] font-normal text-zinc-500">
          {shown.secondary}
        </div>
      )}
    </>
  );
}
