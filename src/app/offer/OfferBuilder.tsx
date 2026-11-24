"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { ItemThumb } from "@/components/ItemThumb";
import { useToast } from "@/components/Toast";
import { formatAmount, parseAmountLoose } from "@/lib/currency";
import { formatDay } from "@/lib/calc/item_drawer";
import {
  isBelowCost,
  offerText,
  offerTotals,
  offerUnitPrice,
  pctOfMarket,
  roundingSteps,
  type OfferLine,
} from "@/lib/calc/offer";
import { STALE_PRICE_HOURS } from "@/lib/calc/attention";
import { ageInHours } from "@/lib/calc/relative_time";
import { recordOfferSale } from "@/lib/server/offer";

export type OfferRow = {
  id: string;
  name: string;
  imageUrl: string | null;
  held: number;
  marketUnit: number;
  /** Epoch ms of the price snapshot the offer is based on. */
  priceAt: number;
  avgCost: number;
};

type Pick = { qty: string; override: string };

const PCT_PRESETS = [70, 80, 85, 90];

function tone(n: number): string {
  return n > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : n < 0
      ? "text-rose-600 dark:text-rose-400"
      : "";
}

function signed(n: number, currency: string): string {
  if (n === 0) return formatAmount(0, currency);
  return `${n > 0 ? "+" : "−"}${formatAmount(Math.abs(n), currency)}`;
}

export function OfferBuilder({
  rows,
  currency,
  exponent,
  now,
  unpricedCount,
  otherCurrencyCount,
}: {
  rows: OfferRow[];
  currency: string;
  exponent: number;
  /** Server time, so "price is 3d old" renders the same on both sides. */
  now: number;
  unpricedCount: number;
  otherCurrencyCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const steps = useMemo(() => roundingSteps(exponent), [exponent]);

  const [pct, setPct] = useState(85);
  const [pctText, setPctText] = useState("85");
  // Zero-decimal currencies (VND) read best at thousand-scale steps.
  const [stepIdx, setStepIdx] = useState(exponent === 0 ? 1 : 0);
  const step = steps[stepIdx]?.step ?? 1;
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  function parseUnit(text: string): number | null {
    if (text.trim() === "") return null;
    try {
      const n = parseAmountLoose(text, currency);
      return n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  function unitFor(r: OfferRow, p: Pick): number {
    return parseUnit(p.override) ?? offerUnitPrice(r.marketUnit, pct, step);
  }

  function qtyFor(r: OfferRow, p: Pick): number {
    const n = Math.floor(Number(p.qty));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, r.held);
  }

  // The lines of the offer, in list order, for everything ticked.
  const lines: OfferLine[] = useMemo(
    () =>
      rows
        .filter((r) => picks[r.id])
        .map((r) => {
          const p = picks[r.id];
          return {
            itemId: r.id,
            name: r.name,
            quantity: qtyFor(r, p),
            marketUnit: r.marketUnit,
            avgCost: r.avgCost,
            offerUnit: unitFor(r, p),
          };
        }),
    // unitFor/qtyFor close over pct, step and currency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, picks, pct, step, currency],
  );
  const totals = useMemo(() => offerTotals(lines), [lines]);
  const belowCost = lines.filter(isBelowCost).length;
  const selectedRows = rows.filter((r) => picks[r.id]);
  const dateLabel = formatDay(now);

  function toggle(r: OfferRow) {
    setPicks((cur) => {
      const next = { ...cur };
      if (next[r.id]) delete next[r.id];
      else next[r.id] = { qty: String(r.held), override: "" };
      return next;
    });
  }

  function patch(id: string, change: Partial<Pick>) {
    setPicks((cur) =>
      cur[id] ? { ...cur, [id]: { ...cur[id], ...change } } : cur,
    );
  }

  function selectVisible() {
    setPicks((cur) => {
      const next = { ...cur };
      for (const r of visible) {
        if (!next[r.id]) next[r.id] = { qty: String(r.held), override: "" };
      }
      return next;
    });
  }

  function applyPct(n: number) {
    setPct(n);
    setPctText(String(n));
  }

  async function copy() {
    const text = offerText(lines, currency, dateLabel);
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ kind: "success", message: "Offer copied to the clipboard" });
    } catch {
      toast.show({
        kind: "error",
        message: "Couldn't copy — your browser blocked clipboard access",
      });
    }
  }

  const none = lines.length === 0;

  return (
    <>
      <Card className="p-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-1">
              Offer at
            </div>
            <div className="flex items-center gap-1.5">
              <div
                role="radiogroup"
                aria-label="Percent of market"
                className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 bg-zinc-50 dark:bg-zinc-800/50"
              >
                {PCT_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={pct === n}
                    onClick={() => applyPct(n)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      pct === n
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium"
                        : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    }`}
                  >
                    {n}%
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1 text-xs text-zinc-500">
                <input
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={pctText}
                  onChange={(e) => {
                    setPctText(e.target.value);
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0 && n <= 200) setPct(n);
                  }}
                  aria-label="Custom percent of market"
                  className="w-16 h-8 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums"
                />
                % of market
              </label>
            </div>
          </div>

          <label className="text-xs text-zinc-500">
            <span className="block text-[11px] uppercase tracking-wider font-medium mb-1">
              Round each to
            </span>
            <select
              value={stepIdx}
              onChange={(e) => setStepIdx(Number(e.target.value))}
              className="h-8 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100"
            >
              {steps.map((s, i) => (
                <option key={s.step} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-zinc-500 flex-1 min-w-[10rem]">
            <span className="block text-[11px] uppercase tracking-wider font-medium mb-1">
              Find
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your stock…"
              className="w-full h-8 px-2.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </label>

          <div className="flex items-center gap-3 text-xs pb-1.5">
            <button
              type="button"
              onClick={selectVisible}
              className="text-zinc-600 dark:text-zinc-300 hover:underline"
            >
              Select {query.trim() ? "shown" : "all"}
            </button>
            <button
              type="button"
              onClick={() => setPicks({})}
              disabled={selectedRows.length === 0}
              className="text-zinc-500 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Clear
            </button>
          </div>
        </div>

        {(unpricedCount > 0 || otherCurrencyCount > 0) && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            {[
              unpricedCount > 0 &&
                `${unpricedCount} item${unpricedCount === 1 ? "" : "s"} in stock ${unpricedCount === 1 ? "has" : "have"} no market price`,
              otherCurrencyCount > 0 &&
                `${otherCurrencyCount} ${otherCurrencyCount === 1 ? "is" : "are"} priced in another currency`,
            ]
              .filter(Boolean)
              .join(" and ")}
            , so{" "}
            {unpricedCount + otherCurrencyCount === 1
              ? "it isn't"
              : "they aren't"}{" "}
            listed here.
          </p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="hidden lg:grid grid-cols-[2rem_minmax(0,1fr)_5rem_7.5rem_9rem_8.5rem_8.5rem] gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-zinc-500 font-medium border-b border-zinc-200/80 dark:border-zinc-800">
          <span />
          <span>Item</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Market</span>
          <span className="text-right">Your offer</span>
          <span className="text-right">Line total</span>
          <span
            className="text-right"
            title="Private — never shown to the buyer"
          >
            Profit 🔒
          </span>
        </div>
        {visible.length === 0 ? (
          <div className="px-4 py-8 text-sm text-zinc-500">
            No stock matches “{query}”.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
            {visible.map((r) => {
              const p = picks[r.id];
              const on = Boolean(p);
              const qty = p ? qtyFor(r, p) : 0;
              const unit = p
                ? unitFor(r, p)
                : offerUnitPrice(r.marketUnit, pct, step);
              const overridden = p ? parseUnit(p.override) != null : false;
              const badOverride =
                p != null &&
                p.override.trim() !== "" &&
                parseUnit(p.override) == null;
              const profit = (unit - r.avgCost) * qty;
              const below = r.avgCost > 0 && unit < r.avgCost;
              const stale =
                ageInHours(new Date(r.priceAt), new Date(now)) >=
                STALE_PRICE_HOURS;
              const days = Math.floor(
                ageInHours(new Date(r.priceAt), new Date(now)) / 24,
              );
              return (
                <li
                  key={r.id}
                  className={`px-4 py-3 grid gap-x-3 gap-y-2 items-center grid-cols-[2rem_minmax(0,1fr)] lg:grid-cols-[2rem_minmax(0,1fr)_5rem_7.5rem_9rem_8.5rem_8.5rem] ${
                    on ? "bg-zinc-50/70 dark:bg-zinc-800/30" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(r)}
                    aria-label={`Offer ${r.name}`}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <div className="flex items-center gap-3 min-w-0">
                    <ItemThumb imageUrl={r.imageUrl} name={r.name} size={36} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.name}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {r.held} in stock
                        {stale && (
                          <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                            · price {days}d old
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Numbers: on a phone they sit under the name. */}
                  <div className="col-start-2 lg:col-start-auto flex lg:block items-center justify-between gap-2 lg:text-right">
                    <span className="lg:hidden text-[11px] text-zinc-500">
                      Qty
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={r.held}
                      step={1}
                      disabled={!on}
                      value={p?.qty ?? String(r.held)}
                      onChange={(e) => patch(r.id, { qty: e.target.value })}
                      aria-label={`Quantity of ${r.name}`}
                      className="w-20 h-8 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-right tabular-nums disabled:opacity-40"
                    />
                  </div>
                  <div className="col-start-2 lg:col-start-auto flex lg:block items-center justify-between lg:text-right tabular-nums text-sm text-zinc-500">
                    <span className="lg:hidden text-[11px]">Market</span>
                    {formatAmount(r.marketUnit, currency)}
                  </div>
                  <div className="col-start-2 lg:col-start-auto flex lg:block items-center justify-between gap-2 lg:text-right">
                    <span className="lg:hidden text-[11px] text-zinc-500">
                      Offer
                    </span>
                    {on ? (
                      <div className="flex items-center gap-1 lg:justify-end">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={p.override}
                          onChange={(e) =>
                            patch(r.id, { override: e.target.value })
                          }
                          placeholder={formatAmount(unit, currency)}
                          aria-label={`Offer per unit for ${r.name}`}
                          aria-invalid={badOverride}
                          className={`w-32 h-8 px-2 rounded-md border bg-white dark:bg-zinc-900 text-sm text-right tabular-nums ${
                            badOverride
                              ? "border-rose-500"
                              : overridden
                                ? "border-sky-500"
                                : "border-zinc-300 dark:border-zinc-700"
                          }`}
                        />
                      </div>
                    ) : (
                      <span className="tabular-nums text-sm text-zinc-400">
                        {formatAmount(unit, currency)}
                      </span>
                    )}
                    {on && (
                      <div className="hidden lg:block text-[11px] text-zinc-500 mt-0.5">
                        {pctOfMarket(unit, r.marketUnit)}% of market
                        {overridden && (
                          <button
                            type="button"
                            onClick={() => patch(r.id, { override: "" })}
                            className="ml-1.5 underline hover:no-underline"
                          >
                            reset
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="col-start-2 lg:col-start-auto flex lg:block items-center justify-between lg:text-right tabular-nums text-sm font-medium">
                    <span className="lg:hidden text-[11px] text-zinc-500 font-normal">
                      Line total
                    </span>
                    {on ? formatAmount(unit * qty, currency) : "—"}
                  </div>
                  <div
                    className={`col-start-2 lg:col-start-auto flex lg:block items-center justify-between lg:text-right tabular-nums text-sm ${
                      on
                        ? below
                          ? "text-rose-600 dark:text-rose-400"
                          : tone(profit)
                        : "text-zinc-400"
                    }`}
                  >
                    <span className="lg:hidden text-[11px] text-zinc-500">
                      Profit 🔒
                    </span>
                    <span>
                      {on ? signed(profit, currency) : "—"}
                      {on && below && (
                        <span className="block text-[10px] font-medium">
                          below cost
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Summary + actions, pinned so it stays in reach while you scroll. */}
      <Card className="p-4 sticky bottom-3 z-10 shadow-lg">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <Tile
            label="Market value"
            value={formatAmount(totals.reference, currency)}
            hint={`${totals.units} unit${totals.units === 1 ? "" : "s"} · ${lines.length} item${lines.length === 1 ? "" : "s"}`}
          />
          <Tile
            label="Offer total"
            value={formatAmount(totals.offer, currency)}
            hint={
              totals.effectivePct != null
                ? `${totals.effectivePct.toFixed(1)}% of market`
                : "nothing selected"
            }
            strong
          />
          <Tile
            label="Buyer saves"
            value={formatAmount(totals.buyerSaves, currency)}
            hint="vs market"
          />
          <Tile
            label="Your profit 🔒"
            value={signed(totals.profit, currency)}
            valueClass={tone(totals.profit)}
            hint="private — not on the sheet"
          />
        </dl>
        {belowCost > 0 && (
          <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
            {belowCost} line{belowCost === 1 ? " sells" : "s sell"} below what
            you paid.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={none}
            onClick={() => setSheetOpen(true)}
            className="inline-flex items-center justify-center rounded-md px-4 h-10 text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-40"
          >
            Open buyer sheet
          </button>
          <button
            type="button"
            disabled={none}
            onClick={copy}
            className="inline-flex items-center justify-center rounded-md px-4 h-10 text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
          >
            Copy as text
          </button>
          <button
            type="button"
            disabled={none}
            onClick={() => setSellOpen(true)}
            className="inline-flex items-center justify-center rounded-md px-4 h-10 text-sm font-medium border border-emerald-600 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-40 sm:ml-auto"
          >
            Mark as sold…
          </button>
        </div>
      </Card>

      {sheetOpen && (
        <BuyerSheet
          lines={lines}
          rows={selectedRows}
          currency={currency}
          dateLabel={dateLabel}
          onCopy={copy}
          onClose={() => setSheetOpen(false)}
        />
      )}
      {sellOpen && (
        <SellConfirm
          lines={lines}
          totalLabel={formatAmount(totals.offer, currency)}
          onClose={() => setSellOpen(false)}
          onDone={(count, total) => {
            setSellOpen(false);
            setPicks({});
            toast.show({
              kind: "success",
              message: `Recorded ${count} sale${count === 1 ? "" : "s"} · ${formatAmount(total, currency)}`,
            });
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  valueClass = "",
  strong = false,
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </dt>
      <dd
        title={value}
        className={`mt-0.5 tabular-nums tracking-tight font-semibold truncate ${
          strong ? "text-xl" : "text-base"
        } ${valueClass}`}
      >
        {value}
      </dd>
      <div className="text-[11px] text-zinc-500 truncate">{hint}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buyer sheet                                                         */
/* ------------------------------------------------------------------ */

function useModalBehaviour(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return closeRef;
}

/**
 * What the buyer sees. Always rendered on a white "paper" card, whatever
 * the app theme, because it is meant to be printed or saved as a PDF. It is
 * built only from buyer-facing fields — cost and profit are not even passed
 * in, so they cannot end up on it.
 */
function BuyerSheet({
  lines,
  rows,
  currency,
  dateLabel,
  onCopy,
  onClose,
}: {
  lines: OfferLine[];
  rows: OfferRow[];
  currency: string;
  dateLabel: string;
  onCopy: () => void;
  onClose: () => void;
}) {
  const closeRef = useModalBehaviour(onClose);
  const t = offerTotals(lines);
  const oldest = rows.length ? Math.min(...rows.map((r) => r.priceAt)) : null;
  const newest = rows.length ? Math.max(...rows.map((r) => r.priceAt)) : null;
  const asOf =
    oldest != null && newest != null
      ? oldest === newest || formatDay(oldest) === formatDay(newest)
        ? formatDay(newest)
        : `${formatDay(oldest)} – ${formatDay(newest)}`
      : null;

  return (
    <div
      className="print-overlay fixed inset-0 z-50 bg-black/50 overflow-y-auto p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Buyer sheet"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="print-area mx-auto max-w-2xl rounded-xl bg-white text-zinc-900 shadow-2xl">
        <div className="p-6 sm:p-8">
          <div className="flex items-baseline justify-between gap-4 border-b border-zinc-200 pb-4">
            <h2 className="text-xl font-semibold tracking-tight">Offer</h2>
            <span className="text-sm text-zinc-500">{dateLabel}</span>
          </div>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium text-right">Qty</th>
                <th className="py-2 font-medium text-right hidden sm:table-cell print:table-cell">
                  Market
                </th>
                <th className="py-2 font-medium text-right">Each</th>
                <th className="py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {lines.map((l) => (
                <tr key={l.itemId} className="align-top">
                  <td className="py-2 pr-3">{l.name}</td>
                  <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 text-right tabular-nums text-zinc-500 hidden sm:table-cell print:table-cell">
                    {formatAmount(l.marketUnit, currency)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatAmount(l.offerUnit, currency)}
                    <div className="text-[11px] text-zinc-500">
                      {pctOfMarket(l.offerUnit, l.marketUnit)}%
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">
                    {formatAmount(l.offerUnit * l.quantity, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 border-t border-zinc-200 pt-4 flex flex-col items-end gap-1">
            <div className="text-lg font-semibold tabular-nums">
              Total {formatAmount(t.offer, currency)}
            </div>
            <div className="text-xs text-zinc-500 tabular-nums">
              {t.units} unit{t.units === 1 ? "" : "s"} · market value{" "}
              {formatAmount(t.reference, currency)} · you save{" "}
              {formatAmount(t.buyerSaves, currency)}
            </div>
          </div>

          {asOf && (
            <p className="mt-6 text-[11px] text-zinc-400">
              Market prices as of {asOf}. This is an offer, not a guarantee of
              price or availability.
            </p>
          )}
        </div>

        <div className="no-print flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3 rounded-b-xl">
          <button
            type="button"
            onClick={onCopy}
            className="h-9 px-3 rounded-md text-sm border border-zinc-300 hover:bg-zinc-100"
          >
            Copy as text
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="h-9 px-3 rounded-md text-sm border border-zinc-300 hover:bg-zinc-100"
          >
            Print / save PDF
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mark as sold                                                        */
/* ------------------------------------------------------------------ */

function nowLocalIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function SellConfirm({
  lines,
  totalLabel,
  onClose,
  onDone,
}: {
  lines: OfferLine[];
  totalLabel: string;
  onClose: () => void;
  onDone: (count: number, totalMinor: number) => void;
}) {
  const closeRef = useModalBehaviour(onClose);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState(nowLocalIso);
  const [note, setNote] = useState("");
  const units = lines.reduce((s, l) => s + l.quantity, 0);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await recordOfferSale({
        lines: lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          totalMinor: l.offerUnit * l.quantity,
        })),
        note: note.trim() === "" ? "Offer sheet sale" : note,
        occurredAt: new Date(when),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone(res.data.count, res.data.totalMinor);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record this sale"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl p-5 flex flex-col gap-4">
        <div>
          <h2 className="font-semibold">Record this sale?</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            This adds <strong>{lines.length}</strong> sell transaction
            {lines.length === 1 ? "" : "s"} ({units} unit
            {units === 1 ? "" : "s"}, <strong>{totalLabel}</strong>) and reduces
            your stock by those units. Each one can be edited or deleted later
            from History.
          </p>
        </div>

        <label className="text-xs text-zinc-500">
          <span className="block mb-1">Date and time of sale</span>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100"
          />
        </label>
        <label className="text-xs text-zinc-500">
          <span className="block mb-1">Buyer / note (saved on each sale)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Offer sheet sale"
            maxLength={500}
            className="w-full h-10 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100"
          />
        </label>

        {error && (
          <div className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-10 px-4 rounded-md text-sm border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || Number.isNaN(new Date(when).getTime())}
            className="h-10 px-4 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Recording…" : "Record sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
