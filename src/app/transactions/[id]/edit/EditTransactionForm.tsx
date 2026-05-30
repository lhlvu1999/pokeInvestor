"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { updateTransaction } from "@/lib/server/transactions";
import {
  Button,
  ButtonLink,
  Checkbox,
  Field,
  Textarea,
  TextInput,
} from "@/components/ui";
import {
  formatAmount,
  minorToDecimalString,
  parseAmount,
} from "@/lib/currency";

type EditableTransaction = {
  id: string;
  itemId: string;
  itemName: string;
  type: "buy" | "sell";
  quantity: number;
  itemCostDecimal: string;
  shippingDecimal: string;
  currency: string;
  occurredAt: Date;
  note: string;
  status: "pending" | "received";
};

function dateToLocalIso(d: Date) {
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function EditTransactionForm({
  transaction,
}: {
  transaction: EditableTransaction;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<"buy" | "sell">(transaction.type);
  const [itemCostStr, setItemCostStr] = useState(transaction.itemCostDecimal);
  const [shippingStr, setShippingStr] = useState(transaction.shippingDecimal);
  const [received, setReceived] = useState(transaction.status === "received");

  const totalPreview = useMemo(() => {
    if (itemCostStr.trim() === "") return null;
    try {
      const itemMinor = parseAmount(itemCostStr, transaction.currency);
      const shippingMinor =
        shippingStr.trim() === ""
          ? 0
          : parseAmount(shippingStr, transaction.currency);
      const total = itemMinor + shippingMinor;
      return {
        minor: total,
        decimal: minorToDecimalString(total, transaction.currency),
        formatted: formatAmount(total, transaction.currency),
      };
    } catch {
      return null;
    }
  }, [itemCostStr, shippingStr, transaction.currency]);

  function onSubmit(formData: FormData) {
    setError(null);
    if (!totalPreview) {
      setError("Enter a valid item cost.");
      return;
    }
    startTransition(async () => {
      const res = await updateTransaction({
        id: transaction.id,
        type,
        quantity: Number(formData.get("quantity") ?? 0),
        finalValue: totalPreview.decimal,
        shipping: shippingStr.trim(),
        status:
          type === "buy" ? (received ? "received" : "pending") : "received",
        occurredAt: new Date(String(formData.get("occurredAt") ?? "")),
        note: String(formData.get("note") ?? ""),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/items/${transaction.itemId}`);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <Field
        label="Item"
        htmlFor="item-display"
        hint="Cannot move a transaction to another item — delete and recreate instead."
      >
        <TextInput
          id="item-display"
          value={transaction.itemName}
          disabled
          readOnly
        />
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
            defaultValue={transaction.quantity}
          />
        </Field>
        <Field label={`Item cost (${transaction.currency})`} htmlFor="itemCost">
          <TextInput
            id="itemCost"
            inputMode="decimal"
            required
            value={itemCostStr}
            onChange={(e) => setItemCostStr(e.target.value)}
          />
        </Field>
      </div>

      <Field
        label={`Shipping ${transaction.currency} (optional)`}
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
                — uncheck for paid-but-on-the-way
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
          defaultValue={dateToLocalIso(transaction.occurredAt)}
        />
      </Field>

      <Field label="Note" htmlFor="note">
        <Textarea
          id="note"
          name="note"
          rows={2}
          defaultValue={transaction.note}
        />
      </Field>

      {error && (
        <div
          ref={(el) => {
            if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }}
          className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300"
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <ButtonLink href={`/items/${transaction.itemId}`} variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
