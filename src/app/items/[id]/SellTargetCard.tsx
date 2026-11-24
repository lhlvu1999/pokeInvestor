"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { useToast } from "@/components/Toast";
import type { TargetStanding } from "@/lib/calc/sell_target";
import { formatAmount } from "@/lib/currency";
import { clearSellTarget, setSellTarget } from "@/lib/server/sell_target";

const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

/**
 * A price to sell at. Once set, a daily check tells you (via the alert
 * webhook, if you've set one) when the market price reaches it, and the
 * dashboard lists the item. Market prices are estimates, so it's a prompt to
 * look, not a certainty that a buyer will pay that.
 */
export function SellTargetCard({
  itemId,
  currency,
  targetCents,
  standing,
  alertedLabel,
  held,
}: {
  itemId: string;
  currency: string;
  targetCents: number | null;
  standing: TargetStanding;
  /** "Nov 20, 2026" when an alert has been sent for the current target. */
  alertedLabel: string | null;
  held: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const res = await setSellTarget(itemId, text, currency);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setText("");
      toast.show({
        kind: "success",
        message: `Sell target set to ${formatAmount(res.data.targetCents, res.data.currency)}`,
      });
      router.refresh();
    });

  const clear = () =>
    start(async () => {
      const res = await clearSellTarget(itemId);
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error });
        return;
      }
      router.refresh();
    });

  return (
    <Card className="p-4">
      <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        Sell target
      </h2>

      {targetCents != null ? (
        <div className="mt-1.5">
          <div className="text-lg font-semibold tabular-nums">
            {formatAmount(targetCents, currency)}
          </div>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-prose">
            {standing.state === "reached"
              ? `The market price is ${formatAmount(standing.priceCents, currency)}, ${pct(standing.aboveBy)} above your target.`
              : standing.state === "below"
                ? `The market price is ${formatAmount(standing.priceCents, currency)}; it needs to rise ${pct(standing.toGo)} to reach your target.`
                : standing.state === "currency_mismatch"
                  ? `The market price is in ${standing.priceCurrency} and the target in ${standing.targetCurrency}, so they can't be compared.`
                  : "There's no market price to compare with yet."}
          </p>
          {alertedLabel && (
            <p className="mt-1 text-[11px] text-zinc-500">
              {`Alert sent ${alertedLabel}.`}
            </p>
          )}
          {held <= 0 && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
              You don&apos;t hold any of this, so no alert will be sent.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-zinc-500 max-w-prose">
          Set a price and you&apos;ll be told when the market price reaches it.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="sell-target">
          Sell target in {currency}
        </label>
        <input
          id="sell-target"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) save();
          }}
          placeholder={`e.g. ${currency === "VND" ? "3m" : "150"}`}
          inputMode="decimal"
          className="h-10 w-36 px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
        />
        <span className="text-xs text-zinc-500">{currency}</span>
        <button
          type="button"
          onClick={save}
          disabled={pending || !text.trim()}
          className="h-10 px-4 rounded-md text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {targetCents != null ? "Change" : "Set target"}
        </button>
        {targetCents != null && (
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
      {error && (
        <div className="mt-2 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}
    </Card>
  );
}
