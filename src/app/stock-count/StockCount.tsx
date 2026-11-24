"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { Button, Card, Select, TextInput } from "@/components/ui";
import { Money } from "@/components/Money";
import { useToast } from "@/components/Toast";
import {
  reconcile,
  shortfallsOf,
  summarizeCount,
  type CountLine,
  type CountRow,
} from "@/lib/calc/stock_count";
import { recordCountShortfalls } from "@/lib/server/stock_count_actions";

const DRAFT_KEY = "poke-stock-count";
const DRAFT_EVENT = "poke-stock-count-change";

/** The saved draft as raw JSON. A string snapshot compares by value, so
 * React only re-renders when the text actually changes. */
function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribeDraft(onChange: () => void) {
  window.addEventListener(DRAFT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DRAFT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeDraft(next: Record<string, string>) {
  try {
    const keep = Object.fromEntries(
      Object.entries(next).filter(([, v]) => v.trim() !== ""),
    );
    if (Object.keys(keep).length === 0) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(keep));
  } catch {
    // Storage blocked: the count still works, it just isn't remembered.
  }
  window.dispatchEvent(new Event(DRAFT_EVENT));
}

type View = "all" | "differences" | "uncounted";

/**
 * Count what is on the shelf, see where it differs from the ledger, and
 * book the shortfalls. A count takes a while, so what you have typed is kept
 * on this device until you record or clear it.
 */
export function StockCount({
  rows,
  currency,
}: {
  rows: CountRow[];
  currency: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const raw = useSyncExternalStore(subscribeDraft, readDraft, () => "");
  const entered = useMemo<Record<string, string>>(() => {
    try {
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }, [raw]);

  const lines = useMemo(() => reconcile(rows, entered), [rows, entered]);
  const summary = useMemo(() => summarizeCount(lines), [lines]);
  const shortfalls = useMemo(() => shortfallsOf(lines), [lines]);

  const term = search.trim().toLowerCase();
  const shown = lines.filter((l) => {
    if (term && !l.name.toLowerCase().includes(term)) return false;
    if (view === "differences")
      return l.status === "short" || l.status === "over";
    if (view === "uncounted") return l.status === "uncounted";
    return true;
  });

  function set(itemId: string, value: string) {
    setError(null);
    writeDraft({ ...entered, [itemId]: value });
  }

  function record() {
    setError(null);
    startTransition(async () => {
      const res = await recordCountShortfalls({ shortfalls });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      writeDraft({});
      router.refresh();
      toast.show({
        kind: "success",
        message: `Recorded ${res.data.units} missing ${res.data.units === 1 ? "unit" : "units"} across ${res.data.count} ${res.data.count === 1 ? "item" : "items"} as lost`,
      });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <Tile label="Counted" hint={`of ${rows.length} items`}>
            {summary.counted}
          </Tile>
          <Tile label="Matches">{summary.matches}</Tile>
          <Tile
            label="Missing"
            hint={
              summary.shortItems > 0
                ? `${summary.shortItems} ${summary.shortItems === 1 ? "item" : "items"}`
                : undefined
            }
            tone={summary.missingUnits > 0 ? "bad" : undefined}
          >
            {summary.missingUnits}{" "}
            {summary.missingUnits === 1 ? "unit" : "units"}
          </Tile>
          <Tile
            label="Cost of missing"
            hint="at what you paid"
            tone={summary.missingCost > 0 ? "bad" : undefined}
          >
            <Money amount={summary.missingCost} currency={currency} />
          </Tile>
        </dl>
        {summary.overItems > 0 && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            {summary.extraUnits} extra{" "}
            {summary.extraUnits === 1 ? "unit" : "units"} on {summary.overItems}{" "}
            {summary.overItems === 1 ? "item" : "items"} than the ledger has.
            Their cost isn&apos;t known, so log them as a purchase from the row.
          </p>
        )}
        {summary.invalid > 0 && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
            {summary.invalid}{" "}
            {summary.invalid === 1 ? "box isn't" : "boxes aren't"} a whole
            number and {summary.invalid === 1 ? "is" : "are"} ignored.
          </p>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          type="search"
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 w-full sm:w-64"
        />
        <Select
          value={view}
          onChange={(e) => setView(e.target.value as View)}
          aria-label="Show"
          className="flex-1 sm:flex-none"
        >
          <option value="all">All items</option>
          <option value="differences">Differences only</option>
          <option value="uncounted">Not counted yet</option>
        </Select>
        <span className="text-xs text-zinc-500 sm:ml-auto">
          {summary.counted > 0
            ? "Saved on this device until you record or clear it"
            : "Leave a box blank to skip an item. Type 0 if none are left."}
        </span>
      </div>

      <Card className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {shown.map((l) => (
          <CountRowView
            key={l.itemId}
            line={l}
            value={entered[l.itemId] ?? ""}
            onChange={(v) => set(l.itemId, v)}
            currency={currency}
          />
        ))}
        {shown.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            {rows.length === 0
              ? "Nothing in stock to count."
              : "No items match."}
          </div>
        )}
      </Card>

      <Card className="p-4 flex flex-col gap-2 sticky bottom-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm min-w-0">
            {shortfalls.length > 0 ? (
              <>
                <span className="font-medium">
                  {summary.missingUnits} missing{" "}
                  {summary.missingUnits === 1 ? "unit" : "units"}
                </span>{" "}
                <span className="text-zinc-500">
                  will be recorded as lost (₫0 sales), bringing the ledger down
                  to the shelf.
                </span>
              </>
            ) : (
              <span className="text-zinc-500">
                Nothing to record yet. Matches and extras change nothing.
              </span>
            )}
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button
              variant="secondary"
              disabled={pending || summary.counted + summary.invalid === 0}
              onClick={() => writeDraft({})}
            >
              Clear count
            </Button>
            <Button
              disabled={pending || shortfalls.length === 0}
              onClick={record}
            >
              {pending
                ? "Recording…"
                : `Record ${shortfalls.length} ${shortfalls.length === 1 ? "shortfall" : "shortfalls"}`}
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}

function Tile({
  label,
  hint,
  tone,
  children,
}: {
  label: string;
  hint?: string;
  tone?: "bad";
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </dt>
      <dd
        className={`mt-1 text-xl font-semibold tabular-nums ${tone === "bad" ? "text-rose-600 dark:text-rose-400" : ""}`}
      >
        {children}
      </dd>
      {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

function CountRowView({
  line,
  value,
  onChange,
  currency,
}: {
  line: CountLine;
  value: string;
  onChange: (v: string) => void;
  currency: string;
}) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-snug">{line.name}</div>
        <div className="text-xs text-zinc-500">
          Ledger says{" "}
          <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">
            {line.ledger}
          </span>
          <Status line={line} currency={currency} />
        </div>
      </div>
      <TextInput
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        aria-label={`Counted ${line.name}`}
        className="w-20 text-right tabular-nums shrink-0"
      />
      {line.status === "over" && (
        <Link
          href={`/transactions/new?itemId=${line.itemId}&type=buy`}
          className="text-xs text-zinc-500 hover:underline shrink-0 hidden sm:inline"
        >
          Log buy
        </Link>
      )}
    </div>
  );
}

function Status({ line, currency }: { line: CountLine; currency: string }) {
  if (line.status === "match")
    return (
      <span className="ml-2 text-emerald-600 dark:text-emerald-400">
        ✓ matches
      </span>
    );
  if (line.status === "short")
    return (
      <span className="ml-2 text-rose-600 dark:text-rose-400">
        {-(line.diff ?? 0)} missing ·{" "}
        <Money amount={line.missingCost} currency={currency} />
      </span>
    );
  if (line.status === "over")
    return (
      <span className="ml-2 text-amber-700 dark:text-amber-400">
        {line.diff} extra
        <Link
          href={`/transactions/new?itemId=${line.itemId}&type=buy`}
          className="ml-2 underline sm:hidden"
        >
          Log buy
        </Link>
      </span>
    );
  if (line.status === "invalid")
    return (
      <span className="ml-2 text-rose-600 dark:text-rose-400">
        not a whole number
      </span>
    );
  return null;
}
