export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { ItemThumb } from "@/components/ItemThumb";
import { releaseLabel } from "@/lib/calc/set_list";
import {
  getSetDetail,
  UpstreamUnavailableError,
} from "@/lib/server/catalog_live";
import {
  getLinkedItems,
  getSealedHistory,
  getSetHistory,
} from "@/lib/server/catalog_sets";
import { changeOver, fromLaunch } from "@/lib/calc/set_history";
import { changeLabel, COMPARABLE_COVERAGE } from "@/lib/calc/set_list";
import { describeFx, showUsd, type Fx } from "@/lib/calc/catalog_money";
import { getDisplayCurrency } from "@/lib/server/settings";
import { getUsdFx } from "@/lib/server/catalog_fx";
import { CardsTable } from "./CardsTable";
import { SetTrackingCard } from "./SetTrackingCard";
import { getSetTracking } from "@/lib/server/catalog_set_tracking";
import { SetHistoryChart } from "./SetHistoryChart";

const changeTone = (c: number | null) =>
  c == null
    ? "text-zinc-400"
    : c > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : c < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-zinc-500";

/**
 * One set, fetched live from TCGCSV when you open it: its value, its top
 * cards, every priced card, and the sealed products (marked where one of your
 * items is linked to it).
 */
export default async function SetPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId: raw } = await params;
  if (!/^\d{1,10}$/.test(raw)) notFound();

  let detail;
  try {
    detail = await getSetDetail(Number(raw));
  } catch (err) {
    if (!(err instanceof UpstreamUnavailableError)) throw err;
    return (
      <div className="flex flex-col gap-4 max-w-2xl">
        <Link href="/catalog" className="text-sm text-zinc-500 hover:underline">
          ← Sets
        </Link>
        <Card className="p-6 text-sm">
          <div className="font-medium">
            This set can&apos;t be loaded right now
          </div>
          <p className="mt-1 text-zinc-600 dark:text-zinc-300">
            TCGCSV isn&apos;t reachable and there is no saved copy of this set
            yet. Try again in a moment.
          </p>
        </Card>
      </div>
    );
  }
  if (!detail) notFound();

  const { set, totals, cards, sealed } = detail;
  const productIds = sealed.map((s) => s.productId);
  const currency = await getDisplayCurrency();
  const [linked, history, sealedHistory, fx] = await Promise.all([
    getLinkedItems(productIds),
    getSetHistory(set.groupId),
    getSealedHistory(productIds),
    getUsdFx(currency),
  ]);
  // How this set is tracking against earlier sets at the same age.
  const tracking = await getSetTracking({
    groupId: set.groupId,
    language: set.language === "ja" ? "ja" : "en",
    publishedOn: set.publishedOn ?? null,
    history,
    sealedProductIds: productIds,
  }).catch(() => null);
  /** An amount in the display currency, with the dollars as a hint. */
  const money = (cents: number) => showUsd(cents, fx);
  // Chart from launch: before most cards were priced the value is near zero.
  const charted = fromLaunch(
    history.map((h) => ({ ...h, priced: h.pricedCount })),
  );
  // The change figures compare against a day when nearly every card was
  // priced, so they measure the market and not cards gaining prices.
  const measured = fromLaunch(
    history.map((h) => ({ ...h, priced: h.pricedCount })),
    COMPARABLE_COVERAGE,
  ).map((h) => ({ day: h.day, cents: h.totalCents }));
  const totalSeries = charted.map((h) => ({ day: h.day, cents: h.totalCents }));
  const top20Series = charted.map((h) => ({ day: h.day, cents: h.top20Cents }));
  const concentration =
    totals.totalCents > 0 ? totals.top20Cents / totals.totalCents : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/catalog" className="text-sm text-zinc-500 hover:underline">
          ← Sets
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {set.name}
        </h1>
        <p className="text-sm text-zinc-500">
          {set.language === "ja" ? "Japanese" : "English"}
          {set.abbreviation ? ` · ${set.abbreviation}` : ""} · released{" "}
          {releaseLabel(set.publishedOn)}
        </p>
        <Link
          href={`/catalog/compare?sets=${set.groupId}`}
          className="mt-1 inline-block text-xs text-sky-700 dark:text-sky-400 hover:underline"
        >
          Compare with other sets
        </Link>
      </div>

      <div
        role="status"
        className={`text-xs rounded-md border px-3 py-2 ${
          detail.source === "live"
            ? "border-zinc-200 dark:border-zinc-800 text-zinc-500"
            : "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
        }`}
      >
        {detail.source === "live"
          ? "Fetched live from TCGplayer's daily feed just now (it updates about 20:00 UTC)."
          : `Showing the last daily sync (${detail.asOf}), top cards only. ${detail.note ?? ""}`}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Set value"
          hint={tileHint(
            totals.pricedCount > 0 ? money(totals.totalCents).secondary : null,
            "one of each card, best version",
          )}
          value={
            totals.pricedCount > 0 ? money(totals.totalCents).primary : "—"
          }
        />
        <Tile
          label="Top 10 cards"
          hint={tileHint(
            totals.pricedCount > 0 ? money(totals.top10Cents).secondary : null,
            totals.totalCents > 0
              ? `${((totals.top10Cents / totals.totalCents) * 100).toFixed(0)}% of the set`
              : null,
          )}
          value={
            totals.pricedCount > 0 ? money(totals.top10Cents).primary : "—"
          }
        />
        <Tile
          label="Top 20 cards"
          hint={tileHint(
            totals.pricedCount > 0 ? money(totals.top20Cents).secondary : null,
            concentration != null
              ? `${(concentration * 100).toFixed(0)}% of the set`
              : null,
          )}
          value={
            totals.pricedCount > 0 ? money(totals.top20Cents).primary : "—"
          }
        />
        <Tile
          label="Cards priced"
          hint="cards with a market price"
          value={`${totals.pricedCount} of ${totals.cardCount}`}
        />
      </div>

      {tracking && (
        <SetTrackingCard
          data={tracking}
          prices={new Map(sealed.map((p) => [p.productId, p.marketCents]))}
          fx={fx}
        />
      )}

      <SetHistoryChart
        total={totalSeries}
        top20={top20Series}
        measured={measured}
        fx={fx}
      />

      {sealed.length > 0 && (
        <section>
          <h2 className="font-medium mb-2">
            Sealed products{" "}
            <span className="text-xs font-normal text-zinc-500">
              {sealed.length}
            </span>
          </h2>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-right font-medium">Market</th>
                  <th className="px-3 py-2 text-right font-medium hidden md:table-cell">
                    30 days
                  </th>
                  <th className="px-3 py-2 text-right font-medium hidden md:table-cell">
                    1 year
                  </th>
                  <th className="px-4 py-2 text-right font-medium hidden sm:table-cell">
                    Lowest listing
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {sealed.map((s) => (
                  <tr key={s.productId}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <ItemThumb
                          imageUrl={s.imageUrl}
                          name={s.name}
                          size={36}
                        />
                        <div className="min-w-0">
                          {s.url ? (
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {s.name}
                            </a>
                          ) : (
                            s.name
                          )}
                          {(linked.get(s.productId) ?? []).map((it) => (
                            <Link
                              key={it.id}
                              href={`/items/${it.id}`}
                              className="ml-2 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 px-1.5 text-[10px] font-medium"
                            >
                              yours: {it.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                      <Amount cents={s.marketCents} fx={fx} />
                    </td>
                    {[30, 365].map((days) => {
                      const c = changeOver(
                        sealedHistory.get(s.productId) ?? [],
                        days,
                      );
                      return (
                        <td
                          key={days}
                          className={`px-3 py-2.5 text-right tabular-nums hidden md:table-cell whitespace-nowrap ${changeTone(c)}`}
                        >
                          {changeLabel(c)}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500 hidden sm:table-cell whitespace-nowrap">
                      <Amount cents={s.lowCents} fx={fx} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      <section>
        <h2 className="font-medium mb-2">
          Cards{" "}
          <span className="text-xs font-normal text-zinc-500">
            most valuable first
          </span>
        </h2>
        {cards.length === 0 ? (
          <Card className="p-6 text-sm text-zinc-500">
            No cards in this set have a market price.
          </Card>
        ) : (
          <CardsTable
            cards={cards}
            truncated={detail.cardsTruncated}
            pricedTotal={totals.pricedCount}
            stored={detail.source === "stored"}
            fx={fx}
          />
        )}
      </section>

      <p className="text-xs text-zinc-500 max-w-prose leading-relaxed">
        Prices are TCGplayer market prices in US dollars, via TCGCSV.{" "}
        {describeFx(fx, currency)} A card counts at its highest-priced printing
        (normal, holo, reverse holo…). Market prices are estimates, not offers
        to buy or sell.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums leading-none">
        {value}
      </div>
      {hint && <div className="text-[11px] text-zinc-500 mt-1.5">{hint}</div>}
    </Card>
  );
}

/** The dollar figure first (when it was converted), then the plain hint. */
function tileHint(
  dollars: string | null,
  hint: string | null,
): string | undefined {
  const parts = [dollars, hint].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** A price cell: the converted amount, with the dollars underneath. */
function Amount({ cents, fx }: { cents: number | null; fx: Fx | null }) {
  if (cents == null) return <>—</>;
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
