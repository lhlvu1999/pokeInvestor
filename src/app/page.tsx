export const dynamic = "force-dynamic";

import Link from "next/link";
import { Money } from "@/components/Money";
import { ButtonLink, Card, EmptyState, StatCard } from "@/components/ui";
import { CashflowChart } from "@/components/CashflowChart";
import { CashflowTagFilter } from "@/components/CashflowTagFilter";
import { TagBadge } from "@/components/TagBadge";
import {
  getDashboardData,
  getMonthlyCashflow,
  rollupByTag,
} from "@/lib/server/portfolio";
import { getDisplayCurrency } from "@/lib/server/settings";

function formatRateLine(
  notes: { from: string; to: string; rate: number; stale: boolean }[],
): string | null {
  if (notes.length === 0) return null;
  const parts = notes.map(
    (n) =>
      `1 ${n.from} ≈ ${n.rate.toFixed(6)} ${n.to}${n.stale ? " (cached)" : ""}`,
  );
  return parts.join(" · ");
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cashflowTags?: string }>;
}) {
  const sp = await searchParams;
  const activeCashflowTags = sp.cashflowTags
    ? sp.cashflowTags
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];

  const displayCurrency = await getDisplayCurrency();
  const { items, converted, summary, fxNotes } =
    await getDashboardData(displayCurrency);

  // Resolve tag filter → set of item ids matching ALL active tags.
  let cashflowItemIds: ReadonlySet<string> | undefined;
  if (activeCashflowTags.length > 0) {
    const matching = items
      .filter(({ item }) =>
        activeCashflowTags.every((t) => item.tags.includes(t)),
      )
      .map(({ item }) => item.id);
    cashflowItemIds = new Set(matching);
  }
  const cashflow = await getMonthlyCashflow(displayCurrency, {
    itemIdsFilter: cashflowItemIds,
  });

  const itemsWithMissingPrice = items.filter(
    (i) => i.valuation.quantity > 0 && i.latestPrice == null,
  ).length;
  const fxLine = formatRateLine(fxNotes);
  const totalSpend = cashflow.reduce((s, m) => s + m.spend, 0);
  const totalRevenue = cashflow.reduce((s, m) => s + m.revenue, 0);
  const totalShipping = cashflow.reduce((s, m) => s + m.shipping, 0);
  const netCashflow = totalRevenue - totalSpend;
  const tagRollup = rollupByTag(items, converted);

  // All tags that appear on any item — surface as chips above the chart.
  const allTags = Array.from(
    new Set(items.flatMap(({ item }) => item.tags)),
  ).sort();

  function chipHrefForTag(tag: string): string {
    const next = activeCashflowTags.includes(tag)
      ? activeCashflowTags.filter((t) => t !== tag)
      : [...activeCashflowTags, tag];
    return next.length === 0 ? "/" : `/?cashflowTags=${next.join(",")}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="text-sm text-zinc-500 hover:underline"
          >
            Display: {displayCurrency}
          </Link>
          <ButtonLink href="/transactions/new">Add transaction</ButtonLink>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No items yet"
          description="Add your first item, then log buy and sell transactions to start tracking profit."
          action={
            <ButtonLink href="/items/new">Add your first item</ButtonLink>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              label="Invested"
              hint="Cost of held inventory"
            >
              <Money amount={summary.invested} currency={displayCurrency} />
            </StatCard>
            <StatCard
              label="Current value"
              hint={
                itemsWithMissingPrice > 0
                  ? `${itemsWithMissingPrice} item(s) missing market price`
                  : "Based on latest market prices"
              }
            >
              <Money
                amount={summary.currentValue}
                currency={displayCurrency}
              />
            </StatCard>
            <StatCard label="Realized">
              <Money
                amount={summary.realized}
                currency={displayCurrency}
                signed
              />
            </StatCard>
            <StatCard label="Unrealized">
              <Money
                amount={summary.unrealized}
                currency={displayCurrency}
                signed
              />
            </StatCard>
            <StatCard label="Total profit">
              <Money
                amount={summary.total}
                currency={displayCurrency}
                signed
              />
            </StatCard>
          </div>

          {fxLine && (
            <div className="text-xs text-zinc-500">FX: {fxLine}</div>
          )}

          <Card className="p-4">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
              <h2 className="font-medium">
                Cashflow by month{" "}
                {activeCashflowTags.length > 0 && (
                  <span className="text-xs text-zinc-500 font-normal">
                    filtered: {activeCashflowTags.join(" + ")}
                  </span>
                )}
              </h2>
              <div className="text-xs text-zinc-500 flex flex-wrap gap-x-4">
                <span>
                  Spent:{" "}
                  <Money amount={totalSpend} currency={displayCurrency} />
                </span>
                <span>
                  Received:{" "}
                  <Money amount={totalRevenue} currency={displayCurrency} />
                </span>
                <span>
                  Net cash:{" "}
                  <Money
                    amount={netCashflow}
                    currency={displayCurrency}
                    signed
                  />
                </span>
                {totalShipping > 0 && (
                  <span>
                    Shipping:{" "}
                    <Money amount={totalShipping} currency={displayCurrency} />
                  </span>
                )}
                {activeCashflowTags.length === 0 && (
                  <span>
                    Realized:{" "}
                    <Money
                      amount={summary.realized}
                      currency={displayCurrency}
                      signed
                    />
                  </span>
                )}
              </div>
            </div>
            <CashflowTagFilter
              chips={allTags.map((tag) => ({
                tag,
                href: chipHrefForTag(tag),
                active: activeCashflowTags.includes(tag),
              }))}
              activeCount={activeCashflowTags.length}
              clearHref="/"
            />
            <CashflowChart data={cashflow} currency={displayCurrency} />
            {activeCashflowTags.length > 0 && cashflow.length === 0 && (
              <div className="text-sm text-zinc-500 mt-3">
                No transactions in this date range match the selected tag
                {activeCashflowTags.length > 1 ? "s" : ""}.
              </div>
            )}
          </Card>

          {tagRollup.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-baseline justify-between gap-2">
                <h2 className="font-medium">
                  By tag{" "}
                  <span className="text-xs text-zinc-500 font-normal">
                    sorted by total spent
                  </span>
                </h2>
                <span className="text-xs text-zinc-500">
                  Items can have multiple tags; totals across tags may exceed
                  the portfolio total.
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Tag</th>
                      <th className="px-4 py-2 text-right font-medium">
                        Items
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        In stock
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Spent
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Received
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Realized
                      </th>
                      <th
                        className="px-4 py-2 text-right font-medium"
                        title="Realized profit ÷ total spent"
                      >
                        Margin
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Stock value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {tagRollup.map((r) => {
                      const margin =
                        r.totalSpent > 0
                          ? (r.realized / r.totalSpent) * 100
                          : null;
                      const marginColor =
                        margin == null
                          ? "text-zinc-400"
                          : margin > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : margin < 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-zinc-500";
                      return (
                        <tr
                          key={r.tag}
                          className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                        >
                          <td className="px-4 py-2.5">
                            <TagBadge tag={r.tag} />
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {r.itemCount}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">
                            {r.itemsHeld}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <Money
                              amount={r.totalSpent}
                              currency={displayCurrency}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <Money
                              amount={r.totalReceived}
                              currency={displayCurrency}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <Money
                              amount={r.realized}
                              currency={displayCurrency}
                              signed
                            />
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums font-medium ${marginColor}`}
                          >
                            {margin == null
                              ? "—"
                              : `${margin > 0 ? "+" : ""}${margin.toFixed(1)}%`}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <Money
                              amount={r.inventoryCost}
                              currency={displayCurrency}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h2 className="font-medium">
                Top items in stock{" "}
                <span className="text-xs text-zinc-500 font-normal">
                  by inventory value
                </span>
              </h2>
              <ButtonLink href="/items" variant="secondary" className="h-8 px-3">
                View all
              </ButtonLink>
            </div>
            {(() => {
              const inStock = items
                .map((withVal, i) => ({ withVal, conv: converted[i] }))
                .filter(({ withVal }) => withVal.valuation.quantity > 0)
                .sort((a, b) => b.conv.inventoryCost - a.conv.inventoryCost);
              if (inStock.length === 0) {
                return (
                  <div className="px-4 py-6 text-sm text-zinc-500">
                    Nothing in stock right now.
                  </div>
                );
              }
              return (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {inStock.slice(0, 6).map(({ withVal: { item, valuation }, conv }) => (
                    <li
                      key={item.id}
                      className="px-4 py-3 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/items/${item.id}`}
                          className="font-medium hover:underline truncate block"
                        >
                          {item.name}
                        </Link>
                        <div className="text-xs text-zinc-500">
                          {valuation.quantity} held • avg{" "}
                          <Money
                            amount={valuation.avgCostCents}
                            currency={valuation.currency}
                          />
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="text-sm">
                          <Money
                            amount={conv.inventoryCost}
                            currency={displayCurrency}
                          />
                        </div>
                        <div className="text-xs text-zinc-500">
                          inventory · unreal{" "}
                          <Money
                            amount={conv.unrealized}
                            currency={displayCurrency}
                            signed
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </Card>
        </>
      )}
    </div>
  );
}
