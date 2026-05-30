"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, Select, TextInput } from "@/components/ui";
import { Money } from "@/components/Money";
import { deleteTransaction } from "@/lib/server/transactions";

export type HistoryRow = {
  id: string;
  itemId: string;
  itemName: string;
  type: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  currency: string;
  occurredAt: string; // ISO string; converted from Date for client serialization
  note: string | null;
  lotId: string | null;
};

type SortKey = "date" | "item" | "type" | "qty" | "amount";
type SortDir = "asc" | "desc";
type TypeFilter = "all" | "buy" | "sell";

const NUMERIC_KEYS = new Set<SortKey>(["qty", "amount", "date"]);

function compare(a: HistoryRow, b: HistoryRow, key: SortKey, dir: SortDir): number {
  let av: string | number;
  let bv: string | number;
  switch (key) {
    case "date":
      av = a.occurredAt;
      bv = b.occurredAt;
      break;
    case "item":
      av = a.itemName.toLowerCase();
      bv = b.itemName.toLowerCase();
      break;
    case "type":
      av = a.type;
      bv = b.type;
      break;
    case "qty":
      av = a.quantity;
      bv = b.quantity;
      break;
    case "amount":
      av = a.finalValueCents;
      bv = b.finalValueCents;
      break;
  }
  let cmp: number;
  if (typeof av === "string" && typeof bv === "string") {
    cmp = av.localeCompare(bv);
  } else {
    cmp = (av as number) - (bv as number);
  }
  return dir === "asc" ? cmp : -cmp;
}

export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const parsedSort = searchParams.get("sort") as SortKey | null;
  const parsedDir = searchParams.get("dir") as SortDir | null;
  const parsedType = searchParams.get("type");

  const [sortKey, setSortKey] = useState<SortKey>(parsedSort ?? "date");
  const [sortDir, setSortDir] = useState<SortDir>(
    parsedDir === "asc" || parsedDir === "desc" ? parsedDir : "desc",
  );
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(
    parsedType === "buy" || parsedType === "sell" ? parsedType : "all",
  );
  const [itemFilter, setItemFilter] = useState<string>(
    () => searchParams.get("item") ?? "all",
  );

  // Sync state → URL (debounced for search).
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      const trimmed = search.trim();
      if (trimmed) params.set("q", trimmed);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (itemFilter !== "all") params.set("item", itemFilter);
      if (sortKey !== "date") params.set("sort", sortKey);
      if (sortDir !== "desc") params.set("dir", sortDir);
      const next = params.toString();
      if (next === searchParams.toString()) return;
      router.replace(next ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [
    search,
    typeFilter,
    itemFilter,
    sortKey,
    sortDir,
    pathname,
    router,
    searchParams,
  ]);

  const itemOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of rows) set.set(r.itemId, r.itemName);
    return Array.from(set.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filteredSorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (itemFilter !== "all" && r.itemId !== itemFilter) return false;
      if (term && !r.itemName.toLowerCase().includes(term)) return false;
      return true;
    });
    out.sort((a, b) => compare(a, b, sortKey, sortDir));
    return out;
  }, [rows, search, typeFilter, itemFilter, sortKey, sortDir]);

  function onHeaderClick(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(NUMERIC_KEYS.has(key) ? "desc" : "asc");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          type="search"
          placeholder="Search by item name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[240px] flex-1 sm:flex-initial"
        />
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
        >
          <option value="all">All types</option>
          <option value="buy">Buys only</option>
          <option value="sell">Sells only</option>
        </Select>
        <Select
          value={itemFilter}
          onChange={(e) => setItemFilter(e.target.value)}
        >
          <option value="all">All items</option>
          {itemOptions.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
        </Select>
        <div className="text-xs text-zinc-500 ml-auto">
          {filteredSorted.length === rows.length
            ? `${rows.length} transactions`
            : `${filteredSorted.length} of ${rows.length} transactions`}
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <SortHeader
                col="date"
                label="Date"
                align="left"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={onHeaderClick}
              />
              <SortHeader
                col="item"
                label="Item"
                align="left"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={onHeaderClick}
              />
              <SortHeader
                col="type"
                label="Type"
                align="left"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={onHeaderClick}
              />
              <SortHeader
                col="qty"
                label="Qty"
                align="right"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={onHeaderClick}
              />
              <SortHeader
                col="amount"
                label="Total"
                align="right"
                sortKey={sortKey}
                sortDir={sortDir}
                onClick={onHeaderClick}
              />
              <th className="px-4 py-2 font-medium text-right">Per unit</th>
              <th className="px-4 py-2 font-medium text-left">Note</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {filteredSorted.map((r) => (
              <Row key={r.id} row={r} />
            ))}
            {filteredSorted.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  No transactions match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Row({ row }: { row: HistoryRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("Delete this transaction? Holdings will be recalculated.")) {
      return;
    }
    startTransition(async () => {
      const res = await deleteTransaction(row.id);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <tr>
      <td className="px-4 py-2 whitespace-nowrap text-zinc-500">
        {new Date(row.occurredAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-2">
        <Link
          href={`/items/${row.itemId}`}
          className="font-medium hover:underline"
        >
          {row.itemName}
        </Link>
      </td>
      <td className="px-4 py-2">
        <span
          className={
            row.type === "buy"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          }
        >
          {row.type === "buy" ? "Buy" : "Sell"}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{row.quantity}</td>
      <td className="px-4 py-2 text-right tabular-nums">
        <Money amount={row.finalValueCents} currency={row.currency} />
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
        <Money
          amount={Math.round(row.finalValueCents / row.quantity)}
          currency={row.currency}
        />
      </td>
      <td className="px-4 py-2 text-zinc-500 max-w-[200px] truncate">
        {row.note ?? ""}
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <Link
          href={`/transactions/${row.id}/edit`}
          className="text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 mr-3"
        >
          Edit
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="text-xs text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50"
        >
          {pending ? "..." : "Delete"}
        </button>
      </td>
    </tr>
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
