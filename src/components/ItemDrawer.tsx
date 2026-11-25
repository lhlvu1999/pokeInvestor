"use client";

/**
 * Item drawer: click an item anywhere and a slide-over shows its price
 * chart (with your buys and sells on it), what you hold, what it's worth
 * and what you've made — without leaving the page you were on.
 *
 * `ItemDrawerProvider` lives once in the layout. `ItemLink` is a drop-in
 * for a link to an item page: a plain click opens the drawer, while
 * ctrl/⌘/shift-click and middle-click still open the full page.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ItemThumb } from "@/components/ItemThumb";
import { SlideOver } from "@/components/SlideOver";
import { formatAmount, formatCompactAmount } from "@/lib/currency";
import {
  DRAWER_RANGES,
  changeOver,
  formatDay,
  nearestIndex,
  priceDomain,
  windowSeries,
  type DrawerRange,
} from "@/lib/calc/item_drawer";
import { formatAge } from "@/lib/calc/relative_time";
import { pct, signed, tone } from "@/lib/calc/format_delta";
import type { ItemDrawerData } from "@/lib/server/item_drawer";

/* ------------------------------------------------------------------ */
/* Context + link                                                      */
/* ------------------------------------------------------------------ */

type Ctx = { open: (id: string, trigger?: HTMLElement | null) => void };
const DrawerContext = createContext<Ctx | null>(null);

export function ItemDrawerProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [openId, setOpenId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Close when the route changes (a link inside the drawer, or browser
  // back), adjusted during render rather than in an effect.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setOpenId(null);
  }

  const open = useCallback((id: string, trigger?: HTMLElement | null) => {
    triggerRef.current =
      trigger ?? (document.activeElement as HTMLElement | null);
    setOpenId(id);
  }, []);

  const close = useCallback(() => {
    setOpenId(null);
    // Hand focus back to whatever opened the drawer.
    const el = triggerRef.current;
    if (el && document.contains(el)) queueMicrotask(() => el.focus());
  }, []);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <DrawerContext.Provider value={value}>
      {children}
      {openId && <ItemDrawer key={openId} id={openId} onClose={close} />}
    </DrawerContext.Provider>
  );
}

export function ItemLink({
  itemId,
  children,
  onClick,
  ...rest
}: { itemId: string } & Omit<ComponentProps<typeof Link>, "href">) {
  const ctx = useContext(DrawerContext);
  return (
    <Link
      {...rest}
      href={`/items/${itemId}`}
      onClick={(e) => {
        onClick?.(e);
        if (!ctx || e.defaultPrevented) return;
        // Leave modified and non-primary clicks to the browser.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
          return;
        e.preventDefault();
        ctx.open(itemId, e.currentTarget);
      }}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

type Loaded = {
  id: string;
  data?: ItemDrawerData;
  error?: string;
  at?: number;
};

function ItemDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [result, setResult] = useState<Loaded | null>(null);
  const [range, setRange] = useState<DrawerRange>("6m");

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/items/${id}/drawer`, { signal: ctrl.signal })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
        return json as ItemDrawerData;
      })
      .then((data) => setResult({ id, data, at: Date.now() }))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setResult({
          id,
          error: e instanceof Error ? e.message : "Failed to load item",
        });
      });
    return () => ctrl.abort();
  }, [id]);

  const ready = result?.id === id ? result : null;

  return (
    <SlideOver
      label="Item"
      ariaLabel={ready?.data?.name ?? "Item details"}
      onClose={onClose}
    >
      {!ready ? (
        <DrawerSkeleton />
      ) : ready.error || !ready.data ? (
        <div className="p-5 text-sm text-rose-600 dark:text-rose-400">
          {ready.error ?? "Could not load this item."}
        </div>
      ) : (
        <DrawerBody
          data={ready.data}
          now={ready.at ?? 0}
          range={range}
          setRange={setRange}
          onNavigate={onClose}
        />
      )}
    </SlideOver>
  );
}

function DrawerSkeleton() {
  return (
    <div className="p-5 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="flex gap-3">
        <div className="w-14 h-14 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-4 rounded bg-zinc-200 dark:bg-zinc-800 w-3/4" />
          <div className="h-3 rounded bg-zinc-200 dark:bg-zinc-800 w-1/3" />
        </div>
      </div>
      <div className="mt-6 h-40 rounded bg-zinc-100 dark:bg-zinc-800/60" />
      <div className="mt-6 grid grid-cols-2 gap-4">
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

function DrawerBody({
  data,
  now,
  range,
  setRange,
  onNavigate,
}: {
  data: ItemDrawerData;
  now: number;
  range: DrawerRange;
  setRange: (r: DrawerRange) => void;
  onNavigate: () => void;
}) {
  const c = data.currency;
  const win = useMemo(
    () => windowSeries(data.points, data.trades, range, now),
    [data.points, data.trades, range, now],
  );
  const change = changeOver(win.points);
  const unrealizedPct =
    data.marketPrice != null && data.inventoryCost > 0
      ? data.unrealized / data.inventoryCost
      : null;
  const priced = data.marketPrice != null;

  return (
    <div className="p-5 flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <ItemThumb imageUrl={data.imageUrl} name={data.name} size={56} />
        <div className="min-w-0">
          <h2 className="font-semibold leading-snug">{data.name}</h2>
          {data.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {data.tags.slice(0, 6).map((t) => (
                <span
                  key={t}
                  className="text-[10px] rounded-full px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700 text-zinc-500"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.set && (
        <Link
          href={`/catalog/sets/${data.set.groupId}`}
          className="block rounded-md border border-sky-300/70 dark:border-sky-800/70 bg-sky-50/60 dark:bg-sky-950/20 px-3 py-2 hover:bg-sky-100/70 dark:hover:bg-sky-950/40"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{data.set.name}</span>
            <span className="shrink-0 text-xs text-sky-800 dark:text-sky-300">Set analytics →</span>
          </div>
          <div className="text-[11px] text-zinc-500">
            {data.set.itemsHeld === 0
              ? "You hold nothing from this set"
              : `You hold ${data.set.itemsHeld} item${data.set.itemsHeld === 1 ? "" : "s"} · ${data.set.units} unit${data.set.units === 1 ? "" : "s"} · worth ${formatCompactAmount(data.set.value, data.set.currency)}`}
          </div>
        </Link>
      )}

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
              Market price
            </div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight">
              {priced ? formatAmount(data.marketPrice!, c) : "No price yet"}
            </div>
          </div>
          {change != null && (
            <div className={`text-sm tabular-nums font-medium ${tone(change)}`}>
              {pct(change)}
              <span className="ml-1 text-xs font-normal text-zinc-500">
                over {range === "all" ? "all time" : range.toUpperCase()}
              </span>
            </div>
          )}
        </div>
        {data.lastPricedAt != null && (
          <div className="text-[11px] text-zinc-500">
            updated {formatAge(new Date(data.lastPricedAt), new Date(now))}
          </div>
        )}
      </div>

      <div>
        <div
          role="radiogroup"
          aria-label="Chart range"
          className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 bg-zinc-50 dark:bg-zinc-800/50"
        >
          {DRAWER_RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={range === r.value}
              onClick={() => setRange(r.value)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                range === r.value
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <PriceChart win={win} currency={c} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Stat
          label="You hold"
          value={String(data.held)}
          hint={data.pending > 0 ? `+${data.pending} on the way` : undefined}
        />
        <Stat
          label="Avg cost"
          value={formatAmount(data.avgCost, c)}
          hint="per unit"
        />
        <Stat
          label="Value"
          value={priced ? formatAmount(data.marketValue, c) : "—"}
          hint={priced ? undefined : "needs a price"}
        />
        <Stat
          label="Unrealized"
          value={priced ? signed(data.unrealized, c) : "—"}
          valueClass={priced ? tone(data.unrealized) : ""}
          hint={
            unrealizedPct != null ? `${pct(unrealizedPct)} on cost` : undefined
          }
        />
        <Stat
          label="Realized"
          value={signed(data.realized, c)}
          valueClass={tone(data.realized)}
          hint="from sales"
        />
        <Stat
          label="Cost held"
          value={formatAmount(data.inventoryCost, c)}
          hint="avg × held"
        />
      </dl>

      {data.recent.length > 0 && (
        <div>
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-1">
            Recent activity
          </h3>
          <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800 text-sm">
            {data.recent.map((t) => (
              <li
                key={t.id}
                className="flex items-baseline justify-between gap-3 py-1.5"
              >
                <span className="min-w-0">
                  <span
                    className={
                      t.type === "buy"
                        ? "text-sky-600 dark:text-sky-400"
                        : "text-amber-600 dark:text-amber-400"
                    }
                  >
                    {t.type === "buy" ? "Bought" : "Sold"}
                  </span>{" "}
                  {t.qty}
                  {t.pending && (
                    <span className="ml-1.5 text-[10px] text-zinc-500">
                      on the way
                    </span>
                  )}
                  <span className="block text-[11px] text-zinc-500">
                    {formatDay(t.t)}
                  </span>
                </span>
                <span className="tabular-nums">{formatAmount(t.total, c)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Link
          href={`/transactions/new?itemId=${data.id}&type=buy`}
          onClick={onNavigate}
          className="inline-flex items-center justify-center rounded-md px-3 h-9 text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Log buy
        </Link>
        <Link
          href={`/transactions/new?itemId=${data.id}&type=sell`}
          onClick={onNavigate}
          className="inline-flex items-center justify-center rounded-md px-3 h-9 text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90"
        >
          Log sell
        </Link>
        <Link
          href={`/items/${data.id}`}
          onClick={onNavigate}
          className="ml-auto text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Open full page →
        </Link>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  valueClass = "",
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-base font-semibold tabular-nums tracking-tight truncate ${valueClass}`}
        title={value}
      >
        {value}
      </dd>
      {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

const W = 400;
const H = 170;
const PAD_L = 46;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 22;

function PriceChart({
  win,
  currency,
}: {
  win: ReturnType<typeof windowSeries>;
  currency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { points, trades, from, to } = win;

  if (points.length < 2) {
    return (
      <p className="mt-3 text-xs text-zinc-500 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4">
        {points.length === 0
          ? "No price history yet. Refresh the price from the item page to start building one."
          : "Only one price snapshot so far — the chart appears once there are two."}
      </p>
    );
  }

  const { lo, hi } = priceDomain(points, trades);
  const tSpan = to - from || 1;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = (t: number) => PAD_L + ((t - from) / tSpan) * plotW;
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * plotH;

  const line = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.price).toFixed(1)}`,
    )
    .join(" ");
  const last = points[points.length - 1];
  const area = `${line} L${x(last.t).toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L${x(points[0].t).toFixed(1)} ${(PAD_T + plotH).toFixed(1)} Z`;
  const up = last.price >= points[0].price;
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="mt-3">
      {/* Fixed-height readout so the chart doesn't jump while hovering. */}
      <div className="h-5 text-xs text-zinc-500 tabular-nums">
        {hp ? (
          <>
            <span className="text-zinc-900 dark:text-zinc-100 font-medium">
              {formatAmount(hp.price, currency)}
            </span>{" "}
            · {formatDay(hp.t)}
          </>
        ) : (
          <span className="inline-flex items-center gap-3">
            <Key color="bg-sky-500" label="Bought" />
            <Key color="bg-amber-500" label="Sold" />
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full select-none touch-none"
        role="img"
        aria-label="Market price history with your buys and sells"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const t = from + ((px - PAD_L) / plotW) * tSpan;
          setHover(nearestIndex(points, t));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[lo, (lo + hi) / 2, hi].map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(v)}
              y2={y(v)}
              className="stroke-zinc-200 dark:stroke-zinc-800"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 5}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-zinc-500 text-[9px] tabular-nums"
            >
              {formatCompactAmount(v, currency)}
            </text>
          </g>
        ))}
        <path
          d={area}
          className={up ? "fill-emerald-500/10" : "fill-rose-500/10"}
        />
        <path
          d={line}
          fill="none"
          strokeWidth={1.75}
          strokeLinejoin="round"
          className={up ? "stroke-emerald-500" : "stroke-rose-500"}
        />
        {hp && (
          <g>
            <line
              x1={x(hp.t)}
              x2={x(hp.t)}
              y1={PAD_T}
              y2={PAD_T + plotH}
              className="stroke-zinc-400"
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hp.t)}
              cy={y(hp.price)}
              r={3.5}
              className={up ? "fill-emerald-500" : "fill-rose-500"}
            />
          </g>
        )}
        {trades.map((tr, i) => (
          <circle
            key={i}
            cx={x(tr.t)}
            cy={y(tr.unit)}
            r={4}
            strokeWidth={1.5}
            className={`stroke-white dark:stroke-zinc-900 ${
              tr.type === "buy" ? "fill-sky-500" : "fill-amber-500"
            }`}
          >
            <title>{`${tr.type === "buy" ? "Bought" : "Sold"} ${tr.qty} at ${formatAmount(tr.unit, currency)} · ${formatDay(tr.t)}`}</title>
          </circle>
        ))}
        <text x={PAD_L} y={H - 6} className="fill-zinc-500 text-[9px]">
          {formatDay(from)}
        </text>
        <text
          x={W - PAD_R}
          y={H - 6}
          textAnchor="end"
          className="fill-zinc-500 text-[9px]"
        >
          {formatDay(to)}
        </text>
      </svg>
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
