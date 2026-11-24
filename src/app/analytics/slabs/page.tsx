export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card, StatCard } from "@/components/ui";
import { ItemThumb } from "@/components/ItemThumb";
import { Money } from "@/components/Money";
import {
  BELOW_RAW,
  WELL_ABOVE_RAW,
  gradeLabel,
  overallPremium,
  premium,
  ratioLabel,
  slabSearchHint,
  summarizeSlabs,
} from "@/lib/calc/slab";
import { getDisplayCurrency } from "@/lib/server/settings";
import { getSlabs } from "@/lib/server/slabs";
import { RejectButton } from "./RejectButton";
import { CardPicker } from "./CardPicker";

const dayLabel = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Graded slabs against the same card ungraded: what each is valued at, what the
 * raw card sells for, and how much more the slab is worth. A description of
 * today's prices, not advice on what to grade or sell.
 */
export default async function SlabsPage() {
  const currency = await getDisplayCurrency();
  const slabs = await getSlabs(currency);

  if (slabs.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight">Slabs</h1>
        <Card className="p-6 text-sm text-zinc-500">
          You don&apos;t hold any graded slabs. Items named like &ldquo;psa 10 …&rdquo; show up here.
        </Card>
      </div>
    );
  }

  const summary = summarizeSlabs(slabs);
  const overall = overallPremium(summary);
  const sorted = [...slabs].sort(
    (a, b) => (b.slabEach ?? b.rawEach ?? 0) * b.qty - (a.slabEach ?? a.rawEach ?? 0) * a.qty,
  );
  const latestRaw = slabs.reduce<Date | null>(
    (m, s) => (s.rawDay && (!m || s.rawDay > m) ? s.rawDay : m),
    null,
  );
  const below = sorted.filter((s) => {
    const p = premium(s.slabEach, s.rawEach);
    return p != null && p.ratio < BELOW_RAW;
  }).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Slabs</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          Each graded slab you hold, next to the same card ungraded. The card is matched automatically from the
          card number, language and name in the slab&apos;s name; a slab is only matched when exactly one card fits.
          It describes today&apos;s prices; it is not advice on what to grade or sell.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Slabs held" hint={`${summary.units} units`}>
          {summary.slabs}
        </StatCard>
        <StatCard label="Slab value" hint={`${summary.slabs - summary.unpriced} of ${summary.slabs} have a price`}>
          <Money amount={summary.slabValue} currency={currency} />
        </StatCard>
        <StatCard
          label="Same cards, raw"
          hint={`${summary.slabs - summary.unmatched} of ${summary.slabs} matched to a card`}
        >
          <Money amount={summary.rawValue} currency={currency} />
        </StatCard>
        <StatCard
          label="Slab premium"
          hint={
            overall
              ? `Over the ${summary.comparable} slabs with both prices`
              : "Needs a slab price and a matched card"
          }
        >
          {overall ? ratioLabel(overall.ratio) : "—"}
        </StatCard>
      </div>

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-2 text-left font-medium">Slab</th>
                <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">Cost</th>
                <th className="px-2 py-2 text-right font-medium">Slab</th>
                <th className="px-2 py-2 text-right font-medium">Raw card</th>
                <th className="pl-2 py-2 text-right font-medium">Premium</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {sorted.map((s) => {
                const p = premium(s.slabEach, s.rawEach);
                return (
                  <tr key={s.itemId} className="align-top">
                    <td className="py-2 pr-2 min-w-0">
                      <div className="flex items-start gap-2">
                        <ItemThumb imageUrl={s.imageUrl} name={s.name} size={36} />
                        <div className="min-w-0">
                          <Link href={`/items/${s.itemId}`} className="font-medium hover:underline">
                            {s.name}
                          </Link>
                          <div className="text-[11px] text-zinc-500">
                            {gradeLabel(s.grade)}
                            {s.qty > 1 ? ` · ${s.qty} units` : ""}
                          </div>
                          {s.card ? (
                            <div className="text-[11px] text-zinc-500">
                              {"Card: "}
                              <Link href={`/catalog/sets/${s.card.groupId}`} className="hover:underline">
                                {s.card.name}
                              </Link>
                              {` · ${s.card.setName}`} <RejectButton id={s.itemId} mode="reject" />
                              {" · "}
                              <CardPicker id={s.itemId} hint={slabSearchHint(s.name)} />
                            </div>
                          ) : (
                            <div className="text-[11px] text-amber-700 dark:text-amber-400">
                              {s.rejected ? "You marked the match wrong. " : "No single clear card found for this slab. "}
                              {s.rejected && <RejectButton id={s.itemId} mode="allow" />}
                              {s.rejected && " · "}
                              <CardPicker id={s.itemId} hint={slabSearchHint(s.name)} />
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                      <Money amount={s.cost} currency={currency} />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {s.slabEach == null ? (
                        <span className="text-zinc-400">no price</span>
                      ) : (
                        <Money amount={s.slabEach} currency={currency} />
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {s.rawEach == null ? (
                        <span className="text-zinc-400">{s.card ? "no price" : "—"}</span>
                      ) : (
                        <>
                          <Money amount={s.rawEach} currency={currency} />
                          {s.rawDay && <div className="text-[11px] text-zinc-500">{dayLabel(s.rawDay)}</div>}
                        </>
                      )}
                    </td>
                    <td className="pl-2 py-2 text-right tabular-nums">
                      {p ? (
                        <>
                          <span className={p.ratio < BELOW_RAW ? "text-amber-700 dark:text-amber-400" : "font-medium"}>
                            {ratioLabel(p.ratio)}
                          </span>
                          <div className="text-[11px]">
                            <Money amount={p.diff} currency={currency} signed />
                          </div>
                          {p.ratio >= WELL_ABOVE_RAW && (
                            <div className="text-[11px] text-amber-700 dark:text-amber-400">check the card</div>
                          )}
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
          {`Values are per unit in ${currency}. The slab value is the app's latest market price for the item (an estimate, for that one grade). The raw price is TCGplayer's market price for the card's best printing, ungraded${latestRaw ? `, as of ${dayLabel(latestRaw)}` : ""}, in dollars at today's rate. The premium is slab ÷ raw: it does not include grading fees, and a slab that came out below raw, or ten times above it or more, is worth checking (wrong card or printing, or a stale price). `}
          {below > 0 ? `${below} slab${below === 1 ? " is" : "s are"} valued below the raw card. ` : ""}
          {summary.unpriced > 0 ? `${summary.unpriced} slab${summary.unpriced === 1 ? " has" : "s have"} no market price yet, so only the raw card is shown for ${summary.unpriced === 1 ? "it" : "them"}. ` : ""}
          Raw prices are stored from the day a slab was matched; new matches appear after the next daily sync.
        </p>
      </Card>
    </div>
  );
}
