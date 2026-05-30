"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createTransaction } from "@/lib/server/transactions";
import {
  Button,
  ButtonLink,
  Checkbox,
  Field,
  Select,
  Textarea,
  TextInput,
} from "@/components/ui";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import {
  formatAmount,
  minorToDecimalString,
  parseAmount,
} from "@/lib/currency";

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
  defaultItemId,
  defaultType,
  defaultCurrency,
}: {
  items: Option[];
  itemCurrency: Record<string, string>;
  itemHeld: Record<string, number>;
  defaultItemId: string | null;
  defaultType: "buy" | "sell";
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
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
  const [itemCostStr, setItemCostStr] = useState("");
  const [shippingStr, setShippingStr] = useState("");
  const [received, setReceived] = useState(true);

  // Live total = item cost + shipping, formatted in the picked currency.
  // Invalid inputs (e.g. mid-typing) yield null and we hide the total preview.
  const totalPreview = useMemo(() => {
    if (itemCostStr.trim() === "") return null;
    try {
      const itemMinor = parseAmount(itemCostStr, currency);
      const shippingMinor =
        shippingStr.trim() === "" ? 0 : parseAmount(shippingStr, currency);
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

  const selectedItemName = useMemo(
    () => items.find((it) => it.id === selectedItemId)?.name ?? "",
    [items, selectedItemId],
  );
  const heldForSelected = selectedItemId
    ? (itemHeld[selectedItemId] ?? 0)
    : null;
  const cancelHref = itemLocked ? `/items/${defaultItemId}` : "/";

  function onSubmit(formData: FormData) {
    setError(null);
    const itemId = String(formData.get("itemId") ?? "");
    const quantity = Number(formData.get("quantity") ?? 0);
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
        status: type === "buy" ? (received ? "received" : "pending") : "received",
        currency,
        occurredAt: new Date(occurredAtRaw),
        note: String(formData.get("note") ?? ""),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/items/${itemId}`);
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
        {itemLocked ? (
          <div className="flex items-center gap-2">
            <input type="hidden" name="itemId" value={selectedItemId} />
            <TextInput
              value={selectedItemName}
              disabled
              readOnly
              className="flex-1"
            />
            <ButtonLink
              href="/transactions/new"
              variant="secondary"
              className="px-3 whitespace-nowrap"
            >
              Change
            </ButtonLink>
          </div>
        ) : (
          <div className="flex gap-2">
            <Select
              id="itemId"
              name="itemId"
              required
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="flex-1"
            >
              <option value="" disabled>
                Select an item
              </option>
              {items.map((it) => {
                const held = itemHeld[it.id] ?? 0;
                return (
                  <option key={it.id} value={it.id}>
                    {it.name}
                    {itemCurrency[it.id] ? ` (${itemCurrency[it.id]})` : ""}
                    {` — ${held} held`}
                  </option>
                );
              })}
            </Select>
            <ButtonLink
              href={`/items/new?returnTo=${encodeURIComponent(
                `/transactions/new?type=${type}`,
              )}`}
              variant="secondary"
              className="px-3 whitespace-nowrap"
            >
              + New item
            </ButtonLink>
          </div>
        )}
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

      <div className="grid grid-cols-2 gap-4">
        <Field label="Quantity" htmlFor="quantity">
          <TextInput
            id="quantity"
            name="quantity"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={1}
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
          label={type === "buy" ? "Item cost" : "Item value (net of fees)"}
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
        </Field>
        <Field
          label={type === "buy" ? "Shipping (optional)" : "Shipping you paid (optional)"}
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

      <Field label="Note" htmlFor="note">
        <Textarea id="note" name="note" rows={2} />
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
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
        <Button
          type="submit"
          disabled={
            pending ||
            (type === "sell" &&
              heldForSelected != null &&
              heldForSelected === 0)
          }
        >
          {pending ? "Saving..." : "Save transaction"}
        </Button>
      </div>
    </form>
  );
}
