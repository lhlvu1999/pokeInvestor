"use client";

/**
 * "What changed": a button on the dashboard that opens a slide-over with
 * what moved in the last 24 hours or week — the value of what you hold, the
 * biggest gains and drops, what you bought and sold, watchlist targets
 * reached, and creator mentions.
 *
 * The data is fetched when the panel opens (and again when the window is
 * switched), so the dashboard itself pays nothing for it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ItemLink } from "@/components/ItemDrawer";
import { ItemThumb } from "@/components/ItemThumb";
import { SlideOver } from "@/components/SlideOver";
import { CHANGE_WINDOWS, type ChangeWindow } from "@/lib/calc/changes";
import { pct, signed, tone } from "@/lib/calc/format_delta";
import { formatAge } from "@/lib/calc/relative_time";
import { formatAmount } from "@/lib/currency";
import type { ChangesData } from "@/lib/server/changes";

export function ChangesButton() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Hand focus back to the button that opened the panel.
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        What changed
      </button>
      {open && <ChangesPanel onClose={close} />}
    </>
  );
}

type Loaded = { window: ChangeWindow; data?: ChangesData; error?: string };

function ChangesPanel({ onClose }: { onClose: () => void }) {
  const [win, setWin] = useState<ChangeWindow>("week");
  const [result, setResult] = useState<Loaded | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/changes?window=${win}`, { signal: ctrl.signal })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
        return json as ChangesData;
      })
      .then((data) => setResult({ window: win, data }))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setResult({
          window: win,
          error: e instanceof Error ? e.message : "Failed to load changes",
        });
      });
    return () => ctrl.abort();
  }, [win]);

  const ready = result?.window === win ? result : null;

  return (
    <SlideOver
      label="What changed"
      ariaLabel="What changed"
      onClose={onClose}
      headerExtra={
        <div
          role="radiogroup"
          aria-label="Time window"
          className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 bg-zinc-50 dark:bg-zinc-800/50"
        >
          {CHANGE_WINDOWS.map((w) => (
            <button
              key={w.value}
              type="button"
              role="radio"
              aria-checked={win === w.value}
              onClick={() => setWin(w.value)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                win === w.value
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      }
    >
      {!ready ? (
        <Skeleton />
      ) : ready.error || !ready.data ? (
        <div className="p-5 text-sm text-rose-600 dark:text-rose-400">
          {ready.error ?? "Could not load changes."}
        </div>
      ) : (
        <Body data={ready.data} onNavigate={onClose} />
      )}
    </SlideOver>
  );
}

function Skeleton() {
  return (
    <div className="p-5 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-3 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-3 h-9 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded bg-zinc-100 dark:bg-zinc-800/60"
          />
        ))}
      </div>
    </div>
  );
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Body({
  data,
  onNavigate,
}: {
  data: ChangesData;
  onNavigate: () => void;
}) {
  const c = data.currency;
  const v = data.value;
  const a = data.activity;
  const label = data.window === "day" ? "24 hours" : "week";
  const nothingRepriced = v.moved === 0;
  const quiet =
    nothingRepriced &&
    a.buys.count + a.sells.count + a.exits.count === 0 &&
    data.watch.length === 0 &&
    data.mentions.length === 0;

  return (
    <div className="p-5 flex flex-col gap-6">
      <section>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
          Value of what you hold
        </div>
        {nothingRepriced ? (
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            No prices were refreshed in the last {label}, so there is no move to
            report.
            {v.lastRefreshAt != null && (
              <>
                {" "}
                Last refresh {formatAge(new Date(v.lastRefreshAt), new Date())}.
              </>
            )}
          </div>
        ) : (
          <>
            <div
              className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${tone(v.impact)}`}
            >
              {signed(v.impact, c)}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {v.moved} item{v.moved === 1 ? "" : "s"} repriced since{" "}
              {when(data.start)}
            </div>
          </>
        )}
        {(v.notRefreshed > 0 || v.noBaseline > 0 || v.unpriced > 0) &&
          !nothingRepriced && (
            <p className="mt-2 text-[11px] text-zinc-500">
              Not counted:{" "}
              {[
                v.notRefreshed > 0 && `${v.notRefreshed} not refreshed`,
                v.noBaseline > 0 && `${v.noBaseline} too new to compare`,
                v.unpriced > 0 && `${v.unpriced} without a price`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        <p className="mt-2 text-[11px] text-zinc-500">
          What you hold today, repriced. Buying or selling isn&apos;t counted
          here — see activity below.
        </p>
      </section>

      {quiet && (
        <p className="text-sm text-zinc-500 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4">
          Nothing happened in the last {label}. Update prices from the dashboard
          to see how the market moved.
        </p>
      )}

      {(data.gainers.length > 0 || data.losers.length > 0) && (
        <section className="flex flex-col gap-4">
          <MoverList
            title="Biggest gains"
            rows={data.gainers}
            currency={c}
            onNavigate={onNavigate}
          />
          <MoverList
            title="Biggest drops"
            rows={data.losers}
            currency={c}
            onNavigate={onNavigate}
          />
        </section>
      )}

      {a.buys.count + a.sells.count + a.exits.count > 0 && (
        <section>
          <SectionTitle>Activity</SectionTitle>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
            <Tile
              label="Bought"
              value={formatAmount(a.buys.total, c)}
              hint={`${a.buys.units} unit${a.buys.units === 1 ? "" : "s"} · ${a.buys.count} buy${a.buys.count === 1 ? "" : "s"}`}
            />
            <Tile
              label="Sold"
              value={formatAmount(a.sells.total, c)}
              hint={`${a.sells.units} unit${a.sells.units === 1 ? "" : "s"} · ${a.sells.count} sale${a.sells.count === 1 ? "" : "s"}`}
            />
          </dl>
          {a.exits.count > 0 && (
            <p className="text-xs text-zinc-500 mb-3">
              {a.exits.units} unit{a.exits.units === 1 ? "" : "s"} gifted, lost
              or opened.
            </p>
          )}
          <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800 text-sm">
            {a.recent.map((t) => (
              <li
                key={t.id}
                className="flex items-baseline justify-between gap-3 py-1.5"
              >
                <span className="min-w-0">
                  <ItemLink
                    itemId={t.itemId}
                    onClick={onNavigate}
                    className="hover:underline line-clamp-1"
                  >
                    {t.name}
                  </ItemLink>
                  <span className="block text-[11px] text-zinc-500">
                    {t.type === "buy"
                      ? "Bought"
                      : t.exitReason
                        ? "Written off"
                        : "Sold"}{" "}
                    {t.quantity} · {when(t.t)}
                  </span>
                </span>
                <span className="tabular-nums shrink-0">
                  {formatAmount(t.total, c)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.watch.length > 0 && (
        <section>
          <SectionTitle>Watchlist at your buy price</SectionTitle>
          <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800 text-sm">
            {data.watch.map((w) => (
              <li
                key={`${w.itemId}-${w.name}`}
                className="flex items-baseline justify-between gap-3 py-1.5"
              >
                <span className="min-w-0">
                  {w.itemId ? (
                    <ItemLink
                      itemId={w.itemId}
                      onClick={onNavigate}
                      className="hover:underline line-clamp-1"
                    >
                      {w.name}
                    </ItemLink>
                  ) : (
                    w.name
                  )}
                  <span className="block text-[11px] text-zinc-500">
                    target {formatAmount(w.targetCents, w.currency)}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="tabular-nums">
                    {formatAmount(w.priceCents, w.currency)}
                  </span>
                  {w.isNew && (
                    <span className="ml-2 text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                      new
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.mentions.length > 0 && (
        <section>
          <SectionTitle>Creator mentions</SectionTitle>
          <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800 text-sm">
            {data.mentions.map((m) => (
              <li
                key={m.itemId}
                className="flex items-baseline justify-between gap-3 py-1.5"
              >
                <span className="min-w-0">
                  <ItemLink
                    itemId={m.itemId}
                    onClick={onNavigate}
                    className="hover:underline line-clamp-1"
                  >
                    {m.name}
                  </ItemLink>
                  <span className="block text-[11px] text-zinc-500">
                    {m.held ? "you hold this" : "on your watchlist"}
                  </span>
                </span>
                <span className="tabular-nums shrink-0 text-xs">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {m.bullish} bullish
                  </span>{" "}
                  <span className="text-rose-600 dark:text-rose-400">
                    {m.bearish} bearish
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">
      {children}
    </h3>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums truncate">
        {value}
      </dd>
      <div className="text-[11px] text-zinc-500">{hint}</div>
    </div>
  );
}

function MoverList({
  title,
  rows,
  currency,
  onNavigate,
}: {
  title: string;
  rows: ChangesData["gainers"];
  currency: string;
  onNavigate: () => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <ul className="flex flex-col gap-1">
        {rows.map((m) => (
          <li key={m.itemId}>
            <ItemLink
              itemId={m.itemId}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
            >
              <ItemThumb imageUrl={m.imageUrl} name={m.name} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm line-clamp-1">{m.name}</span>
                <span className="block text-[11px] text-zinc-500 tabular-nums">
                  {formatAmount(m.fromUnit, currency)} →{" "}
                  {formatAmount(m.toUnit, currency)}
                  {m.quantity > 1 && ` · ×${m.quantity}`}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span
                  className={`block text-sm font-medium tabular-nums ${tone(m.impact)}`}
                >
                  {signed(m.impact, currency)}
                </span>
                <span
                  className={`block text-[11px] tabular-nums ${tone(m.changePct)}`}
                >
                  {pct(m.changePct)}
                </span>
              </span>
            </ItemLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
