"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { FLOOR_PRESETS, floorFromCost, type FloorStanding } from "@/lib/calc/price_floor";
import { formatAmount, minorToDecimalString } from "@/lib/currency";
import { clearPriceFloor, setPriceFloor } from "@/lib/server/price_floor";

const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

/**
 * A price to be told about if the market falls to it. Once set, a daily check
 * tells you (via the alert webhook, if you've set one) when the market price
 * reaches it, and the dashboard lists the item. It is a heads-up about a price you
 * chose, not advice, and market prices are estimates.
 */
export function PriceFloorCard({
  itemId,
  currency,
  floorCents,
  standing,
  alertedLabel,
  held,
  avgCostCents,
}: {
  itemId: string;
  currency: string;
  floorCents: number | null;
  standing: FloorStanding;
  /** "Nov 20, 2026" when an alert has been sent for the current floor. */
  alertedLabel: string | null;
  held: number;
  /** What you paid per held unit, in `currency`; 0 when you hold none. */
  avgCostCents: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (amount: string) =>
    start(async () => {
      setError(null);
      const res = await setPriceFloor(itemId, amount, currency);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setText("");
      toast.show({
        kind: "success",
        message: `Price floor set to ${formatAmount(res.data.floorCents, res.data.currency)}`,
      });
      router.refresh();
    });

  const clear = () =>
    start(async () => {
      const res = await clearPriceFloor(itemId);
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      router.refresh();
    });

  const presets = FLOOR_PRESETS.map((p) => ({ ...p, cents: floorFromCost(avgCostCents, p.below) })).filter(
    (p): p is typeof p & { cents: number } => p.cents != null,
  );

  return (
    <Card className="p-4">
      <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Price floor</h2>

      {floorCents != null ? (
        <div className="mt-1.5">
          <div className="text-lg font-semibold tabular-nums">{formatAmount(floorCents, currency)}</div>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-prose">
            {standing.state === "reached"
              ? standing.belowBy === 0
                ? `The market price is ${formatAmount(standing.priceCents, currency)}, right at your floor.`
                : `The market price is ${formatAmount(standing.priceCents, currency)}, ${pct(standing.belowBy)} below your floor.`
              : standing.state === "above"
                ? `The market price is ${formatAmount(standing.priceCents, currency)}; it would have to fall ${pct(standing.toFall)} to reach your floor.`
                : standing.state === "currency_mismatch"
                  ? `The market price is in ${standing.priceCurrency} and the floor in ${standing.floorCurrency}, so they can't be compared.`
                  : "There's no market price to compare with yet."}
          </p>
          {alertedLabel && <p className="mt-1 text-[11px] text-zinc-500">{`Alert sent ${alertedLabel}.`}</p>}
          {held <= 0 && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
              You don&apos;t hold any of this, so no alert will be sent.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-zinc-500 max-w-prose">
          Set a price and you&apos;ll be told if the market price falls to it.
        </p>
      )}

      {presets.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={pending}
              onClick={() => save(minorToDecimalString(p.cents, currency))}
              className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              title={`Set the floor to ${formatAmount(p.cents, currency)}`}
            >
              {`${p.label} (${formatAmount(p.cents, currency)})`}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="price-floor">
          Price floor in {currency}
        </label>
        <input
          id="price-floor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) save(text);
          }}
          placeholder={`e.g. ${currency === "VND" ? "2m" : "100"}`}
          inputMode="decimal"
          className="h-10 w-36 px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
        />
        <span className="text-xs text-zinc-500">{currency}</span>
        <button
          type="button"
          onClick={() => save(text)}
          disabled={pending || !text.trim()}
          className="h-10 px-4 rounded-md text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {floorCents != null ? "Change" : "Set floor"}
        </button>
        {floorCents != null && (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="h-10 px-3 text-sm text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>
      {error && <div className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</div>}
    </Card>
  );
}
