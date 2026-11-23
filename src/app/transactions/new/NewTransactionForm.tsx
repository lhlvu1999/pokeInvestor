"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { createTransaction } from "@/lib/server/transactions";
import { useToast } from "@/components/Toast";
import { suggestedTotal } from "@/lib/calc/entry_hints";
import { defaultsToZeroValue, type ExitReason } from "@/lib/calc/exit_reason";
import { ExitReasonPicker } from "@/components/ExitReasonPicker";
import {
  Button,
  ButtonLink,
  Checkbox,
  Field,
  Textarea,
  TextInput,
} from "@/components/ui";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import {
  formatAmount,
  minorToDecimalString,
  parseAmountLoose,
} from "@/lib/currency";
import { ItemPicker, type PickerOption } from "./ItemPicker";

type Option = { id: string; name: string };

function nowLocalIso() {
  const d = new Date();
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function NewTransactionForm({
  items,
  itemCurrency,
  itemHeld,
  itemMarket,
  itemLastBuy,
  defaultItemId,
  defaultType,
  defaultExit,
  defaultCurrency,
}: {
  items: Option[];
  itemCurrency: Record<string, string>;
  itemHeld: Record<string, number>;
  /** Latest market price per unit, by item id. */
  itemMarket: Record<string, { priceMinor: number; currency: string }>;
  /** Per-unit item cost of the most recent buy (excl. shipping), by item id. */
  itemLastBuy: Record<string, number>;
  defaultItemId: string | null;
  defaultType: "buy" | "sell";
  /** Pre-selected exit reason, from a "Gift / lost / opened" link. */
  defaultExit: ExitReason;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  // Which submit button was pressed: "done" goes to the item page, "another"
  // stays here and clears the form for the next entry.
  const submitMode = useRef<"done" | "another">("done");
  const [focusSignal, setFocusSignal] = useState(0);
  const [qtyStr, setQtyStr] = useState("1");
  const [noteStr, setNoteStr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<"buy" | "sell">(defaultType);
  // When invoked via "Log buy" / "Log sell" the URL has itemId — lock the
  // item to that one so the user can't accidentally change it mid-edit.
  const itemLocked = Boolean(defaultItemId);
  const [selectedItemId, setSelectedItemId] = useState(defaultItemId ?? "");
  const lockedCurrency = useMemo(
    () => (selectedItemId ? itemCurrency[selectedItemId] : undefined),
    [selectedItemId, itemCurrency],
  );
  const [pickedCurrency, setPickedCurrency] = useState(defaultCurrency);
  const currency = lockedCurrency ?? pickedCurrency;
  const [exitReason, setExitReason] = useState<ExitReason>(defaultExit);
  // A gift or loss brings in nothing, so start at 0 instead of an empty box.
  const [itemCostStr, setItemCostStr] = useState(
    defaultsToZeroValue(defaultExit) ? "0" : "",
  );
  const [shippingStr, setShippingStr] = useState("");
  const [received, setReceived] = useState(true);

  // Live total = item cost + shipping, formatted in the picked currency.
  // Invalid inputs (e.g. mid-typing) yield null and we hide the total preview.
  const totalPreview = useMemo(() => {
    if (itemCostStr.trim() === "") return null;
    try {
      const itemMinor = parseAmountLoose(itemCostStr, currency);
      const shippingMinor =
        shippingStr.trim() === "" ? 0 : parseAmountLoose(shippingStr, currency);
      const total = itemMinor + shippingMinor;
      return {
        minor: total,
        decimal: minorToDecimalString(total, currency),
        formatted: formatAmount(total, currency),
      };
    } catch {
      return null;
    }
  }, [itemCostStr, shippingStr, currency]);

  // Per-unit hints. The cost field is a TOTAL, so each "use" button fills
  // quantity × per-unit rather than the bare unit price.
  const qty = Number(qtyStr);
  const market = selectedItemId ? itemMarket[selectedItemId] : undefined;
  const marketTotal =
    market && market.currency === currency
      ? suggestedTotal(market.priceMinor, qty)
      : null;
  const lastBuy = selectedItemId ? itemLastBuy[selectedItemId] : undefined;
  const lastBuyTotal =
    type === "buy" && lastBuy != null ? suggestedTotal(lastBuy, qty) : null;

  const selectedItemName = useMemo(
    () => items.find((it) => it.id === selectedItemId)?.name ?? "",
    [items, selectedItemId],
  );
  const heldForSelected = selectedItemId
    ? (itemHeld[selectedItemId] ?? 0)
    : null;
  const cancelHref = itemLocked ? `/items/${defaultItemId}` : "/";

  function pickExitReason(next: ExitReason) {
    setExitReason(next);
    if (defaultsToZeroValue(next)) setItemCostStr("0");
    else if (itemCostStr.trim() === "0") setItemCostStr("");
  }

  const isExit = type === "sell" && exitReason !== "sold";

  function onSubmit(formData: FormData) {
    setError(null);
    const itemId = String(formData.get("itemId") ?? "");
    const quantity = Number(formData.get("quantity") ?? 0);
    const mode = submitMode.current;
    submitMode.current = "done";
    const occurredAtRaw = String(formData.get("occurredAt") ?? "");

    if (!totalPreview) {
      setError("Enter a valid item cost.");
      return;
    }
    const finalValue = totalPreview.decimal;
    const shippingValue = shippingStr.trim();

    startTransition(async () => {
      const res = await createTransaction({
        itemId,
        type,
        quantity,
        finalValue,
        shipping: shippingValue,
        status:
          type === "buy" ? (received ? "received" : "pending") : "received",
        currency,
        occurredAt: new Date(occurredAtRaw),
        note: String(formData.get("note") ?? ""),
        exitReason: type === "sell" ? exitReason : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (mode === "done") {
        router.push(`/items/${itemId}`);
        router.refresh();
        return;
      }
      // Add another: confirm, reset the per-entry fields, and put the cursor
      // back in the item search. Type, currency, fulfillment and time carry
      // over — a run of entries usually shares them.
      toast.show({
        kind: "success",
        message: `Saved ${isExit ? exitReason : type} · ${quantity} × ${selectedItemName || "item"} · ${totalPreview.formatted}`,
      });
      if (!itemLocked) setSelectedItemId("");
      setQtyStr("1");
      setItemCostStr(defaultsToZeroValue(exitReason) ? "0" : "");
      setShippingStr("");
      setNoteStr("");
      setFocusSignal((n) => n + 1);
      // Held counts and "last bought" hints come from the server.
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <Field
        label="Item"
        htmlFor="itemId"
        hint={
          heldForSelected != null
            ? `Currently held: ${heldForSelected}${
                type === "sell" && heldForSelected === 0
                  ? " — cannot sell, nothing in stock"
                  : ""
              }`
            : undefined
        }
      >
        {(() => {
          const pickerOptions: PickerOption[] = items.map((it) => ({
            id: it.id,
            name: it.name,
            currency: itemCurrency[it.id] ?? defaultCurrency,
            held: itemHeld[it.id] ?? 0,
            marketMinor: itemMarket[it.id]?.priceMinor ?? null,
          }));
          return (
            <ItemPicker
              items={pickerOptions}
              value={selectedItemId}
              onChange={setSelectedItemId}
              locked={itemLocked}
              focusSignal={focusSignal}
            />
          );
        })()}
      </Field>

      <Field label="Type" htmlFor="type">
        <div className="flex gap-2" id="type">
          <button
            type="button"
            onClick={() => setType("buy")}
            className={`flex-1 h-10 rounded-md border text-sm font-medium ${
              type === "buy"
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setType("sell")}
            className={`flex-1 h-10 rounded-md border text-sm font-medium ${
              type === "sell"
                ? "border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            Sell
          </button>
        </div>
      </Field>

      {type === "sell" && (
        <Field label="Why is it leaving?" htmlFor="exitReason">
          <ExitReasonPicker value={exitReason} onChange={pickExitReason} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Quantity" htmlFor="quantity">
          <TextInput
            id="quantity"
            name="quantity"
            type="number"
            min={1}
            step={1}
            required
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value)}
          />
        </Field>
        <Field
          label="Currency"
          htmlFor="currency"
          hint={
            lockedCurrency
              ? "Locked to existing transaction currency"
              : undefined
          }
        >
          <CurrencyPicker
            id="currency"
            name="currency"
            value={currency}
            disabled={Boolean(lockedCurrency)}
            onChange={(e) => setPickedCurrency(e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label={
            type === "buy"
              ? "Item cost"
              : isExit
                ? "Value you kept (0 = write off)"
                : "Item value (net of fees)"
          }
          htmlFor="itemCost"
        >
          <TextInput
            id="itemCost"
            inputMode="decimal"
            required
            value={itemCostStr}
            onChange={(e) => setItemCostStr(e.target.value)}
            placeholder="0"
          />
          {(marketTotal != null || lastBuyTotal != null) && (
            <div className="mt-1.5 flex flex-col gap-1 text-[11px] text-zinc-500">
              {marketTotal != null && market && (
                <div>
                  Market {formatAmount(market.priceMinor, currency)} each ·{" "}
                  <button
                    type="button"
                    onClick={() =>
                      setItemCostStr(
                        minorToDecimalString(marketTotal, currency),
                      )
                    }
                    className="underline hover:no-underline text-zinc-700 dark:text-zinc-300"
                  >
                    use {formatAmount(marketTotal, currency)}
                  </button>
                </div>
              )}
              {lastBuyTotal != null && lastBuy != null && (
                <div>
                  Last bought {formatAmount(lastBuy, currency)} each ·{" "}
                  <button
                    type="button"
                    onClick={() =>
                      setItemCostStr(
                        minorToDecimalString(lastBuyTotal, currency),
                      )
                    }
                    className="underline hover:no-underline text-zinc-700 dark:text-zinc-300"
                  >
                    use {formatAmount(lastBuyTotal, currency)}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="text-[10px] text-zinc-500 mt-1">
            Tip: <code>5m</code> = 5,000,000 · <code>2.5k</code> = 2,500
          </div>
        </Field>
        <Field
          label={
            type === "buy"
              ? "Shipping (optional)"
              : "Shipping you paid (optional)"
          }
          htmlFor="shipping"
        >
          <TextInput
            id="shipping"
            inputMode="decimal"
            value={shippingStr}
            onChange={(e) => setShippingStr(e.target.value)}
            placeholder="0"
          />
        </Field>
      </div>
      {totalPreview && (
        <div className="text-xs text-zinc-500 -mt-2">
          Total {type === "buy" ? "paid" : "received"}:{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
            {totalPreview.formatted}
          </span>
        </div>
      )}

      {type === "buy" && (
        <Field label="Fulfillment" htmlFor="received">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <Checkbox
              id="received"
              checked={received}
              onChange={(e) => setReceived(e.target.checked)}
            />
            <span>
              Already received{" "}
              <span className="text-zinc-500">
                — uncheck if the item has been paid for but is still on the way
              </span>
            </span>
          </label>
        </Field>
      )}

      <Field label="Time" htmlFor="occurredAt">
        <TextInput
          id="occurredAt"
          name="occurredAt"
          type="datetime-local"
          required
          defaultValue={nowLocalIso()}
        />
      </Field>

      <Field
        label={
          type === "buy"
            ? "Note — why did you buy this?"
            : isExit
              ? "Note — what happened?"
              : "Note — why did you sell?"
        }
        htmlFor="note"
        hint="A line for your future self. Six months from now, this is the retrospective."
      >
        <Textarea
          id="note"
          name="note"
          rows={2}
          value={noteStr}
          onChange={(e) => setNoteStr(e.target.value)}
          placeholder={
            type === "buy"
              ? "e.g. Creator X said this is undervalued after the reprint"
              : "e.g. Locked in profit; freed capital for the Prismatic Evolutions box"
          }
        />
      </Field>

      {error && (
        <div
          ref={(el) => {
            // Scroll the error into view so it isn't missed below the fold.
            if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }}
          className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300"
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <ButtonLink href={cancelHref} variant="secondary" className="order-1">
          Cancel
        </ButtonLink>
        {(() => {
          const blocked =
            type === "sell" && heldForSelected != null && heldForSelected === 0;
          // DOM order puts the primary button first, because Enter in a
          // text field "clicks" the first submit button and that should be
          // plain Save. `order-*` puts it last on screen, where people look
          // for it.
          return (
            <>
              <Button
                type="submit"
                className="order-3"
                disabled={pending || blocked}
                onClick={() => {
                  submitMode.current = "done";
                }}
              >
                {pending ? "Saving..." : "Save transaction"}
              </Button>
              <Button
                type="submit"
                variant="secondary"
                className="order-2"
                disabled={pending || blocked}
                onClick={() => {
                  submitMode.current = "another";
                }}
              >
                Save & add another
              </Button>
            </>
          );
        })()}
      </div>
    </form>
  );
}
