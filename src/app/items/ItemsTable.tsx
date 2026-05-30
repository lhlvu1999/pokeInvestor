"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, Select, TextInput } from "@/components/ui";
import { Money } from "@/components/Money";
import { TagBadge } from "@/components/TagBadge";
import type { ItemWithValuation } from "@/lib/server/items";
import type { ConvertedItemValues } from "@/lib/calc/portfolio";

type SortKey =
  | "name"
  | "status"
  | "held"
  | "pending"
  | "sold"
  | "avgCost"
  | "stockValue"
  | "market"
  | "totalSpent"
  | "realized"
  | "unrealized"
  | "total";

type SortDir = "asc" | "desc";

type Row = {
  withVal: ItemWithValuation;
  conv: ConvertedItemValues;
};

const NUMERIC_KEYS: SortKey[] = [
  "held",
  "pending",
  "sold",
  "avgCost",
  "stockValue",
  "market",
  "totalSpent",
  "realized",
  "unrealized",
  "total",
];

type Status = "in-stock" | "on-the-way" | "sold-out" | "empty";

type ItemVal = {
  quantity: number;
  soldQuantity: number;
  pendingQuantity: number;
};

/**
 * Returns every status that applies to an item. An item with held > 0 AND
 * pending > 0 belongs to BOTH "in-stock" and "on-the-way" sets.
 */
function statusesOf(v: ItemVal): Status[] {
  const out: Status[] = [];
  if (v.quantity > 0) out.push("in-stock");
  if (v.pendingQuantity > 0) out.push("on-the-way");
  if (
    v.quantity === 0 &&
    v.pendingQuantity === 0 &&
    v.soldQuantity > 0
  )
    out.push("sold-out");
  if (
    v.quantity === 0 &&
    v.pendingQuantity === 0 &&
    v.soldQuantity === 0
  )
    out.push("empty");
  return out;
}

/** Primary status used for default sort ordering by the Status column. */
function primaryStatus(v: ItemVal): Status {
  const all = statusesOf(v);
  return all[0] ?? "empty";
}

const STATUS_ORDER: Record<Status, number> = {
  "in-stock": 0,
  "on-the-way": 1,
  "sold-out": 2,
  empty: 3,
};

type StatusFilter = "all" | Status;

function parseStatusFilter(raw: string | null): StatusFilter {
  switch (raw) {
    case "in-stock":
    case "on-the-way":
    case "sold-out":
    case "empty":
      return raw;
    default:
      return "all";
  }
}

function valueFor(row: Row, key: SortKey, displayCurrency: string): number | string {
  const { withVal, conv } = row;
  switch (key) {
    case "name":
      return withVal.item.name.toLowerCase();
    case "status":
      return STATUS_ORDER[primaryStatus(withVal.valuation)];
    case "held":
      return withVal.valuation.quantity;
    case "pending":
      return withVal.valuation.pendingQuantity;
    case "sold":
      return withVal.valuation.soldQuantity;
    case "avgCost":
      // Avg cost is in native currency; for cross-currency comparison fall
      // back to inventoryCost / quantity in display currency when held > 0.
      return withVal.valuation.quantity > 0
        ? conv.inventoryCost / withVal.valuation.quantity
        : 0;
    case "stockValue":
      return conv.inventoryCost;
    case "market":
      return withVal.latestPrice?.priceCents ?? -1;
    case "totalSpent":
      return conv.totalSpent;
    case "realized":
      return conv.realized;
    case "unrealized":
      return conv.unrealized;
    case "total":
      return conv.realized + conv.unrealized;
  }
  // exhaustiveness fallback
  void displayCurrency;
  return 0;
}

function compare(a: Row, b: Row, key: SortKey, dir: SortDir, displayCurrency: string): number {
  const av = valueFor(a, key, displayCurrency);
  const bv = valueFor(b, key, displayCurrency);
  let cmp: number;
  if (typeof av === "string" && typeof bv === "string") {
    cmp = av.localeCompare(bv);
  } else {
    cmp = (av as number) - (bv as number);
  }
  return dir === "asc" ? cmp : -cmp;
}

export function ItemsTable({
  items,
  converted,
  displayCurrency,
}: {
  items: ItemWithValuation[];
  converted: ConvertedItemValues[];
  displayCurrency: string;
}) {
  // Filter state is persisted in the URL so it survives refresh, can be
  // bookmarked, and is shareable. Initial values come from URL params on
  // first render; subsequent state changes sync back via router.replace.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialSort = searchParams.get("sort") as SortKey | null;
  const initialDir = searchParams.get("dir") as SortDir | null;
  const [sortKey, setSortKey] = useState<SortKey>(initialSort ?? "name");
  const [sortDir, setSortDir] = useState<SortDir>(
    initialDir === "asc" || initialDir === "desc" ? initialDir : "asc",
  );
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    parseStatusFilter(searchParams.get("status")),
  );
  const [activeTags, setActiveTags] = useState<string[]>(
    () =>
      searchParams
        .get("tags")
        ?.split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean) ?? [],
  );

  // Sync state → URL. Debounced so typing in the search field doesn't spam
  // the address bar on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      const trimmed = search.trim();
      if (trimmed) params.set("q", trimmed);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (activeTags.length > 0) params.set("tags", activeTags.join(","));
      if (sortKey !== "name") params.set("sort", sortKey);
      if (sortDir !== "asc") params.set("dir", sortDir);
      const next = params.toString();
      // Skip the replace when the URL already matches — prevents an extra
      // navigation on mount and on echo from our own replace.
      if (next === searchParams.toString()) return;
      const url = next ? `${pathname}?${next}` : pathname;
      router.replace(url, { scroll: false });
    }, 200);
    return () => clearTimeout(timer);
  }, [
    search,
    statusFilter,
    activeTags,
    sortKey,
    sortDir,
    pathname,
    router,
    searchParams,
  ]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const t of it.item.tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [items]);

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function onHeaderClick(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns default to descending (largest first); name defaults to ascending.
      setSortDir(NUMERIC_KEYS.includes(key) ? "desc" : "asc");
    }
  }

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows: Row[] = items
      .map((withVal, i) => ({ withVal, conv: converted[i] }))
      .filter(({ withVal }) => {
        if (term && !withVal.item.name.toLowerCase().includes(term)) {
          return false;
        }
        if (statusFilter !== "all") {
          const has = statusesOf(withVal.valuation);
          if (!has.includes(statusFilter)) return false;
        }
        if (activeTags.length > 0) {
          const itemTags = withVal.item.tags;
          // AND match: item must have every active tag.
          for (const t of activeTags) {
            if (!itemTags.includes(t)) return false;
          }
        }
        return true;
      });
    rows.sort((a, b) => compare(a, b, sortKey, sortDir, displayCurrency));
    return rows;
  }, [
    items,
    converted,
    sortKey,
    sortDir,
    displayCurrency,
    search,
    statusFilter,
    activeTags,
  ]);

  const totalCount = items.length;
  const shownCount = sorted.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <TextInput
          type="search"
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[260px] flex-1 sm:flex-initial"
        />
        <Select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as StatusFilter)
          }
          aria-label="Status filter"
        >
          <option value="all">All statuses</option>
          <option value="in-stock">In stock only</option>
          <option value="on-the-way">On the way only</option>
          <option value="sold-out">Sold out only</option>
          <option value="empty">No transactions</option>
        </Select>
        <div className="text-xs text-zinc-500 ml-auto">
          {shownCount === totalCount
            ? `${totalCount} items`
            : `${shownCount} of ${totalCount} items`}
        </div>
      </div>
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-500 mr-1">Filter by tag:</span>
          {allTags.map((tag) => {
            const active = activeTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`text-[10px] rounded-full px-2 py-0.5 border ${
                  active
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {tag}
              </button>
            );
          })}
          {activeTags.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTags([])}
              className="text-[10px] text-zinc-500 hover:underline ml-1"
            >
              clear
            </button>
          )}
        </div>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <SortHeader
              col="name"
              label="Item"
              align="left"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <th className="px-4 py-2 font-medium text-left">Tags</th>
            <SortHeader
              col="status"
              label="Status"
              align="left"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="held"
              label="Held"
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="pending"
              label="Pending"
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="sold"
              label="Sold"
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="avgCost"
              label="Avg cost"
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="stockValue"
              label={`Stock value (${displayCurrency})`}
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="market"
              label="Market"
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="totalSpent"
              label={`Total spent (${displayCurrency})`}
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="realized"
              label={`Realized (${displayCurrency})`}
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="unrealized"
              label={`Unrealized (${displayCurrency})`}
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
            <SortHeader
              col="total"
              label={`Total (${displayCurrency})`}
              align="right"
              sortKey={sortKey}
              sortDir={sortDir}
              onClick={onHeaderClick}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {sorted.map(({ withVal: { item, valuation, latestPrice }, conv }) => (
            <tr
              key={item.id}
              className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/items/${item.id}`}
                  className="font-medium hover:underline"
                >
                  {item.name}
                </Link>
                {(item.setCode || item.cardNumber) && (
                  <div className="text-xs text-zinc-500">
                    {[item.setCode, item.cardNumber].filter(Boolean).join(" • ")}
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className="cursor-pointer"
                    >
                      <TagBadge tag={t} />
                    </button>
                  ))}
                  {item.tags.length === 0 && (
                    <span className="text-xs text-zinc-400">—</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {statusesOf(valuation).map((s) => (
                    <StatusBadge key={s} status={s} />
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {valuation.quantity}
              </td>
              <td
                className={`px-4 py-3 text-right tabular-nums ${
                  valuation.pendingQuantity > 0
                    ? "text-amber-700 dark:text-amber-400 font-medium"
                    : "text-zinc-400"
                }`}
                title={
                  valuation.pendingQuantity > 0
                    ? "Buys paid for but not yet received"
                    : undefined
                }
              >
                {valuation.pendingQuantity}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-500">
                {valuation.soldQuantity}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                <Money
                  amount={valuation.avgCostCents}
                  currency={valuation.currency}
                />
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-medium">
                <Money
                  amount={valuation.quantity > 0 ? conv.inventoryCost : null}
                  currency={displayCurrency}
                />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                <Money
                  amount={latestPrice?.priceCents ?? null}
                  currency={latestPrice?.currency ?? null}
                />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                <Money amount={conv.totalSpent} currency={displayCurrency} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                <Money amount={conv.realized} currency={displayCurrency} signed />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                <Money
                  amount={latestPrice ? conv.unrealized : null}
                  currency={displayCurrency}
                  signed
                />
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-medium">
                <Money
                  amount={conv.realized + (latestPrice ? conv.unrealized : 0)}
                  currency={displayCurrency}
                  signed
                />
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={13}
                className="px-4 py-8 text-center text-sm text-zinc-500"
              >
                No items match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; className: string }> = {
    "in-stock": {
      label: "In stock",
      className:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
    },
    "on-the-way": {
      label: "On the way",
      className:
        "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
    },
    "sold-out": {
      label: "Sold out",
      className:
        "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
    },
    empty: {
      label: "No transactions",
      className:
        "bg-zinc-50 text-zinc-500 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-700",
    },
  };
  const { label, className } = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function SortHeader({
  col,
  label,
  align,
  sortKey,
  sortDir,
  onClick,
}: {
  col: SortKey;
  label: string;
  align: "left" | "right";
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (col: SortKey) => void;
}) {
  const active = sortKey === col;
  const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "";
  return (
    <th
      className={`px-4 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 ${
          active ? "text-zinc-900 dark:text-zinc-100" : ""
        }`}
      >
        <span>{label}</span>
        {arrow && <span className="text-[10px]">{arrow}</span>}
      </button>
    </th>
  );
}
