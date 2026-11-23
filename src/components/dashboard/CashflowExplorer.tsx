"use client";

import { ItemLink } from "@/components/ItemDrawer";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { formatAmount, formatCompactAmount } from "@/lib/currency";
import {
  buildMonthSeries,
  capMagnitude,
  formatMonthLong,
  formatMonthShort,
  monthsBetween,
  niceDomain,
  rangeToParams,
  resolveWindow,
  topPurchases,
  topSales,
  totalsOf,
  type ItemRollup,
  type MonthTotals,
  type PresetKind,
  type RangeSpec,
  type WindowLine,
} from "@/lib/calc/cashflow_window";

type Mode = "flow" | "net";

const PRESETS: { kind: PresetKind; label: string }[] = [
  { kind: "3m", label: "3M" },
  { kind: "6m", label: "6M" },
  { kind: "12m", label: "12M" },
  { kind: "all", label: "All" },
];

// Chart geometry. Width comes from the container; height is fixed so the
// chart doesn't jump when the range changes.
const HEIGHT = 236;
const PAD_TOP = 12;
const PAD_BOTTOM = 36;
const PAD_LEFT = 52;
const PAD_RIGHT = 8;
const MIN_COL_W = 12;
const DEFAULT_WIDTH = 640; // used for SSR and the first client render

const GREEN = "fill-emerald-500 dark:fill-emerald-400";
const RED = "fill-rose-500 dark:fill-rose-400";

function signedText(n: number, currency: string): string {
  if (n === 0) return formatAmount(0, currency);
  return `${n > 0 ? "+" : "−"}${formatAmount(Math.abs(n), currency)}`;
}

function tone(n: number): string {
  return n > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : n < 0
      ? "text-rose-600 dark:text-rose-400"
      : "";
}

/**
 * Cashflow you can actually explore: pick a window (3M / 6M / 12M / All /
 * custom), see money in vs. out per month on a zero baseline, click a month
 * to focus on it, and read which items drove it.
 *
 * Every number — bars, tiles, item lists — is summed from the same
 * per-(month, item) lines, so they always agree with each other.
 */
export function CashflowExplorer({
  lines,
  bounds,
  currency,
  initialRange,
  nowMonth,
  filterLabel,
  filterSlot,
}: {
  lines: WindowLine[];
  bounds: { first: string; last: string } | null;
  currency: string;
  initialRange: RangeSpec;
  /** "YYYY-MM" computed on the server so first paint matches hydration. */
  nowMonth: string;
  /** Description of the active tag filter, if any. */
  filterLabel: string | null;
  /** Tag chips, rendered by the server and slotted in under the header. */
  filterSlot?: ReactNode;
}) {
  const [range, setRange] = useState<RangeSpec>(initialRange);
  const [mode, setMode] = useState<Mode>("flow");
  const [fullScale, setFullScale] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Keep the URL in step with the range so a refresh or shared link lands on
  // the same view. replaceState, not router.replace — no server round-trip.
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const k of ["cf", "cffrom", "cfto"]) url.searchParams.delete(k);
    for (const [k, v] of Object.entries(rangeToParams(range))) {
      url.searchParams.set(k, v);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (
      next !==
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    ) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [range]);

  const window_ = useMemo(
    () =>
      bounds
        ? resolveWindow(range, bounds, nowMonth)
        : { from: nowMonth, to: nowMonth },
    [range, bounds, nowMonth],
  );
  const months = useMemo(
    () => monthsBetween(window_.from, window_.to),
    [window_],
  );
  const series = useMemo(
    () => buildMonthSeries(lines, months),
    [lines, months],
  );
  const windowTotals = useMemo(() => totalsOf(series), [series]);

  const focus = pinned && months.includes(pinned) ? pinned : null;
  const scopeMonths = useMemo(
    () => new Set(focus ? [focus] : months),
    [focus, months],
  );
  const scopeTotals = focus
    ? totalsOf(series.filter((m) => m.month === focus))
    : windowTotals;
  const purchases = useMemo(
    () => topPurchases(lines, scopeMonths, 5),
    [lines, scopeMonths],
  );
  const sales = useMemo(
    () => topSales(lines, scopeMonths, 5),
    [lines, scopeMonths],
  );

  if (!bounds) {
    return (
      <Card className="p-4">
        <h2 className="font-medium text-sm mb-2">Cashflow</h2>
        {filterSlot}
        <p className="text-sm text-zinc-500">
          {filterLabel
            ? `No transactions match ${filterLabel}.`
            : "No transactions yet — add some to see your cashflow."}
        </p>
      </Card>
    );
  }

  const allMonths = monthsBetween(
    bounds.first,
    nowMonth > bounds.last ? nowMonth : bounds.last,
  );
  const isCustom = range.kind === "custom";
  const scopeLabel = focus
    ? formatMonthLong(focus)
    : months.length === 1
      ? formatMonthLong(months[0])
      : `${formatMonthShort(months[0])} – ${formatMonthShort(months[months.length - 1])}`;
  const scopeKind = focus
    ? "Focused month"
    : range.kind === "all"
      ? "All time"
      : range.kind === "custom"
        ? "Custom range"
        : `Last ${months.length} month${months.length === 1 ? "" : "s"}`;

  const choose = (r: RangeSpec) => {
    setRange(r);
    setPinned(null);
    setFullScale(false);
  };

  return (
    <Card className="@container p-4 sm:p-5">
      {/* Header: title + range controls */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="font-medium text-sm">
          Cashflow{" "}
          {filterLabel && (
            <span className="text-xs text-zinc-500 font-normal">
              filtered: {filterLabel}
            </span>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Time range"
            value={isCustom ? "custom" : range.kind}
            onChange={(v) => {
              if (v === "custom") {
                choose({ kind: "custom", from: window_.from, to: window_.to });
              } else {
                choose({ kind: v as PresetKind });
              }
            }}
            options={[
              ...PRESETS.map((p) => ({ value: p.kind, label: p.label })),
              { value: "custom", label: "Custom" },
            ]}
          />
        </div>
      </div>

      {isCustom && range.kind === "custom" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <label className="flex items-center gap-1.5">
            From
            <MonthSelect
              value={window_.from}
              options={allMonths}
              onChange={(from) =>
                choose({
                  kind: "custom",
                  from,
                  to: from > window_.to ? from : window_.to,
                })
              }
            />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <MonthSelect
              value={window_.to}
              options={allMonths}
              onChange={(to) =>
                choose({
                  kind: "custom",
                  from: to < window_.from ? to : window_.from,
                  to,
                })
              }
            />
          </label>
        </div>
      )}

      {filterSlot && <div className="mt-3">{filterSlot}</div>}

      {/* Summary for whatever is in scope */}
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {scopeKind}
        </span>
        <span>· {scopeLabel}</span>
        {focus && (
          <button
            type="button"
            onClick={() => setPinned(null)}
            className="ml-1 rounded-full border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ← back to {range.kind === "all" ? "all time" : "range"}
          </button>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-2 @lg:grid-cols-4 gap-x-4 gap-y-3">
        <Tile
          label="Spent"
          value={formatAmount(scopeTotals.spend, currency)}
          hint={
            scopeTotals.shipping > 0
              ? `incl. ${formatCompactAmount(scopeTotals.shipping, currency)} shipping`
              : `${scopeTotals.unitsBought} unit${scopeTotals.unitsBought === 1 ? "" : "s"} bought`
          }
        />
        <Tile
          label="Received"
          value={formatAmount(scopeTotals.revenue, currency)}
          hint={`${scopeTotals.unitsSold} unit${scopeTotals.unitsSold === 1 ? "" : "s"} sold`}
        />
        <Tile
          label="Net cash"
          value={signedText(scopeTotals.net, currency)}
          valueClass={tone(scopeTotals.net)}
          hint="received − spent"
        />
        <Tile
          label="Realized profit"
          value={signedText(scopeTotals.realized, currency)}
          valueClass={tone(scopeTotals.realized)}
          hint="on items sold"
        />
      </dl>

      {/* Chart */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Chart view"
          value={mode}
          onChange={(v) => {
            setMode(v as Mode);
            setFullScale(false);
          }}
          options={[
            { value: "flow", label: "In / out" },
            { value: "net", label: "Net" },
          ]}
        />
        <Legend mode={mode} />
      </div>

      <Chart
        series={series}
        currency={currency}
        mode={mode}
        fullScale={fullScale}
        setFullScale={setFullScale}
        pinned={focus}
        hover={hover}
        setHover={setHover}
        onPick={(m) => setPinned((cur) => (cur === m ? null : m))}
      />

      {/* What drove it */}
      <div className="mt-5 pt-4 border-t border-zinc-200/80 dark:border-zinc-800">
        {purchases.length === 0 && sales.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No purchases or sales in {scopeLabel}.
          </p>
        ) : (
          <div className="grid gap-5 @xl:grid-cols-2">
            <ItemList
              title="Biggest purchases"
              rows={purchases}
              currency={currency}
              unit="bought"
              empty={`Nothing bought in ${scopeLabel}.`}
            />
            <ItemList
              title="Biggest sales"
              rows={sales}
              currency={currency}
              unit="sold"
              showProfit
              empty={`Nothing sold in ${scopeLabel}.`}
            />
          </div>
        )}
        {!focus && months.length > 1 && (
          <p className="mt-4 text-[11px] text-zinc-500">
            Tip: click a month in the chart to see just that month.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

function Chart({
  series,
  currency,
  mode,
  fullScale,
  setFullScale,
  pinned,
  hover,
  setHover,
  onPick,
}: {
  series: MonthTotals[];
  currency: string;
  mode: Mode;
  fullScale: boolean;
  setFullScale: (v: boolean) => void;
  pinned: string | null;
  hover: string | null;
  setHover: (m: string | null) => void;
  onPick: (m: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = series.length;
  // Values drawn above / below the zero line, per month.
  const ups = series.map((m) =>
    mode === "flow" ? m.revenue : Math.max(0, m.net),
  );
  const downs = series.map((m) =>
    mode === "flow" ? m.spend : Math.max(0, -m.net),
  );

  const capUp = capMagnitude(ups);
  const capDown = capMagnitude(downs);
  const capping = !fullScale && (capUp.capped || capDown.capped);
  const upMax = capping && capUp.capped ? capUp.max : Math.max(0, ...ups);
  const downMax =
    capping && capDown.capped ? capDown.max : Math.max(0, ...downs);
  const domain = niceDomain(upMax, downMax);

  const chartW = Math.max(width, PAD_LEFT + PAD_RIGHT + n * MIN_COL_W);
  const plotW = chartW - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const colW = plotW / Math.max(1, n);
  const barW = Math.max(4, Math.min(36, colW * 0.62));
  const span = domain.hi - domain.lo || 1;
  const yFor = (v: number) => PAD_TOP + ((domain.hi - v) / span) * plotH;
  const zeroY = yFor(0);

  const cappedMonths = capping
    ? series.filter(
        (_, i) =>
          (capUp.capped && ups[i] > domain.hi) ||
          (capDown.capped && downs[i] > -domain.lo),
      )
    : [];

  const stride = Math.max(1, Math.ceil(38 / colW));
  const longLabels = colW >= 56;
  const nothing = series.every((m) => m.spend === 0 && m.revenue === 0);

  const tipMonth = hover ?? null;
  const tip = tipMonth ? series.find((m) => m.month === tipMonth) : undefined;
  const tipIdx = tip ? series.indexOf(tip) : -1;
  const tipX = PAD_LEFT + (tipIdx + 0.5) * colW;
  // Keep the tooltip inside the chart: flip to the left of the column when
  // the column is in the right half.
  const tipOnLeft = tipX > chartW / 2;

  return (
    <div className="mt-2">
      <div ref={wrapRef} className="relative w-full overflow-x-auto">
        <div className="relative" style={{ width: chartW }}>
          <svg
            width={chartW}
            height={HEIGHT}
            viewBox={`0 0 ${chartW} ${HEIGHT}`}
            className="block select-none"
            role="group"
            aria-label={`Monthly cashflow, ${mode === "flow" ? "money in and out" : "net"}`}
          >
            {/* Grid + y labels */}
            {domain.ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD_LEFT}
                  x2={chartW - PAD_RIGHT}
                  y1={yFor(t)}
                  y2={yFor(t)}
                  className={
                    t === 0
                      ? "stroke-zinc-400 dark:stroke-zinc-500"
                      : "stroke-zinc-200 dark:stroke-zinc-800"
                  }
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 6}
                  y={yFor(t) + 3}
                  textAnchor="end"
                  className="fill-zinc-500 text-[10px] tabular-nums"
                >
                  {t === 0 ? "0" : formatCompactAmount(Math.abs(t), currency)}
                </text>
              </g>
            ))}

            {series.map((m, i) => {
              const cx = PAD_LEFT + (i + 0.5) * colW;
              const isPinned = pinned === m.month;
              const isHover = hover === m.month;
              const dim = pinned != null && !isPinned;
              const up = ups[i];
              const down = downs[i];
              const upClamped = Math.min(up, domain.hi);
              const downClamped = Math.min(down, -domain.lo);
              const upTop = yFor(upClamped);
              const downBottom = yFor(-downClamped);
              const upCut = up > domain.hi;
              const downCut = down > -domain.lo;
              const showLabel = (n - 1 - i) % stride === 0;
              const [monthName] = formatMonthShort(m.month).split(" ");
              const showYear =
                !longLabels && (m.month.endsWith("-01") || i === 0);
              const aria = `${formatMonthLong(m.month)}: spent ${formatAmount(m.spend, currency)}, received ${formatAmount(m.revenue, currency)}, net ${signedText(m.net, currency)}`;

              return (
                <g
                  key={m.month}
                  role="button"
                  tabIndex={0}
                  aria-label={aria}
                  aria-pressed={isPinned}
                  className="cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-zinc-500"
                  onPointerEnter={() => setHover(m.month)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(m.month)}
                  onBlur={() => setHover(null)}
                  onClick={() => onPick(m.month)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(m.month);
                    }
                  }}
                >
                  {/* Hit area + hover/pinned backdrop */}
                  <rect
                    x={PAD_LEFT + i * colW}
                    y={PAD_TOP}
                    width={colW}
                    height={HEIGHT - PAD_TOP}
                    rx={4}
                    strokeWidth={1}
                    className={
                      isPinned
                        ? "fill-zinc-100 dark:fill-zinc-800 stroke-zinc-300 dark:stroke-zinc-600"
                        : isHover
                          ? "fill-zinc-50 dark:fill-zinc-800/60 stroke-transparent"
                          : "fill-transparent stroke-transparent"
                    }
                  />
                  {up > 0 && (
                    <rect
                      x={cx - barW / 2}
                      y={upTop}
                      width={barW}
                      height={Math.max(1, zeroY - upTop)}
                      rx={2}
                      opacity={dim ? 0.35 : 1}
                      className={GREEN}
                    />
                  )}
                  {down > 0 && (
                    <rect
                      x={cx - barW / 2}
                      y={zeroY}
                      width={barW}
                      height={Math.max(1, downBottom - zeroY)}
                      rx={2}
                      opacity={dim ? 0.35 : 1}
                      className={RED}
                    />
                  )}
                  {/* Break marks: this bar is longer than the axis. */}
                  {upCut && <BreakMark x={cx} y={upTop + 7} w={barW} />}
                  {downCut && <BreakMark x={cx} y={downBottom - 7} w={barW} />}

                  {showLabel && (
                    <text
                      x={cx}
                      y={HEIGHT - PAD_BOTTOM + 14}
                      textAnchor="middle"
                      className={`text-[10px] ${isPinned ? "fill-zinc-900 dark:fill-zinc-100 font-medium" : "fill-zinc-500"}`}
                    >
                      {longLabels ? formatMonthShort(m.month) : monthName}
                    </text>
                  )}
                  {showLabel && showYear && (
                    <text
                      x={cx}
                      y={HEIGHT - PAD_BOTTOM + 26}
                      textAnchor="middle"
                      className="fill-zinc-400 dark:fill-zinc-500 text-[9px]"
                    >
                      {m.month.slice(0, 4)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {tip && (
            <div
              className="pointer-events-none absolute z-10 w-52 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg px-3 py-2 text-xs"
              style={{
                top: PAD_TOP,
                ...(tipOnLeft
                  ? { right: chartW - tipX + colW / 2 + 6 }
                  : { left: tipX + colW / 2 + 6 }),
              }}
            >
              <div className="font-medium mb-1">
                {formatMonthLong(tip.month)}
              </div>
              <TipRow label="Spent" value={formatAmount(tip.spend, currency)} />
              <TipRow
                label="Received"
                value={formatAmount(tip.revenue, currency)}
              />
              <TipRow
                label="Net"
                value={signedText(tip.net, currency)}
                className={tone(tip.net)}
              />
              <TipRow
                label="Realized"
                value={signedText(tip.realized, currency)}
                className={tone(tip.realized)}
              />
              <div className="mt-1 text-[11px] text-zinc-500">
                {tip.buys} buy{tip.buys === 1 ? "" : "s"} · {tip.sells} sell
                {tip.sells === 1 ? "" : "s"}
              </div>
            </div>
          )}
        </div>
      </div>

      {nothing && (
        <p className="mt-2 text-xs text-zinc-500">
          No money moved in this window.
        </p>
      )}

      {cappedMonths.length > 0 && (
        <p className="mt-2 text-[11px] text-zinc-500">
          {cappedMonths.map((m) => formatMonthShort(m.month)).join(", ")} is
          much larger than the rest, so its bar is cut off (see the break mark)
          to keep other months readable.{" "}
          <button
            type="button"
            onClick={() => setFullScale(true)}
            className="underline hover:no-underline"
          >
            Show full scale
          </button>
        </p>
      )}
      {fullScale && (capUp.capped || capDown.capped) && (
        <p className="mt-2 text-[11px] text-zinc-500">
          Showing full scale.{" "}
          <button
            type="button"
            onClick={() => setFullScale(false)}
            className="underline hover:no-underline"
          >
            Cut off the large month
          </button>
        </p>
      )}
    </div>
  );
}

/** Two slanted white strokes across a bar — the usual "axis break" symbol. */
function BreakMark({ x, y, w }: { x: number; y: number; w: number }) {
  const half = w / 2 + 1;
  return (
    <g
      className="stroke-white dark:stroke-zinc-900"
      strokeWidth={2}
      strokeLinecap="butt"
    >
      <line x1={x - half} y1={y + 2} x2={x + half} y2={y - 2} />
      <line x1={x - half} y1={y + 6} x2={x + half} y2={y + 2} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 bg-zinc-50 dark:bg-zinc-800/50"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              active
                ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function MonthSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-900 dark:text-zinc-100"
    >
      {options.map((m) => (
        <option key={m} value={m}>
          {formatMonthLong(m)}
        </option>
      ))}
    </select>
  );
}

function Tile({
  label,
  value,
  hint,
  valueClass = "",
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </dt>
      <dd
        title={value}
        className={`mt-0.5 text-[15px] @2xl:text-lg font-semibold tabular-nums tracking-tight whitespace-nowrap overflow-hidden text-ellipsis ${valueClass}`}
      >
        {value}
      </dd>
      <div className="text-[11px] text-zinc-500 truncate">{hint}</div>
    </div>
  );
}

function Legend({ mode }: { mode: Mode }) {
  return (
    <div className="flex items-center gap-3 text-[11px] text-zinc-500">
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
        {mode === "flow" ? "Received" : "Net gain"}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500" />
        {mode === "flow" ? "Spent" : "Net outflow"}
      </span>
    </div>
  );
}

function TipRow({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className={`tabular-nums font-medium ${className}`}>{value}</span>
    </div>
  );
}

function ItemList({
  title,
  rows,
  currency,
  unit,
  showProfit = false,
  empty,
}: {
  title: string;
  rows: ItemRollup[];
  currency: string;
  unit: string;
  showProfit?: boolean;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
          {rows.map((r) => (
            <li key={r.itemId}>
              <ItemLink
                itemId={r.itemId}
                className="flex items-baseline justify-between gap-3 py-1.5 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <span className="min-w-0">
                  <span className="block text-sm truncate">{r.itemName}</span>
                  <span className="block text-[11px] text-zinc-500">
                    {r.units} {unit}
                    {showProfit && r.realized !== 0 && (
                      <>
                        {" · "}
                        <span className={tone(r.realized)}>
                          {signedText(r.realized, currency)} profit
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <span className="text-sm tabular-nums shrink-0">
                  {formatAmount(r.amount, currency)}
                </span>
              </ItemLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
