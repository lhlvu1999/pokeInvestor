"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setManualPrice } from "@/lib/server/prices";
import { minorToDecimalString } from "@/lib/currency";
import { Button, Field, TextInput } from "@/components/ui";
import { CurrencyPicker } from "@/components/CurrencyPicker";

export function MarketPriceForm({
  itemId,
  currentMinor,
  currency,
  currencyLocked,
}: {
  itemId: string;
  currentMinor: number | null;
  currency: string;
  currencyLocked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pickedCurrency, setPickedCurrency] = useState(currency);
  const [value, setValue] = useState(
    currentMinor != null ? minorToDecimalString(currentMinor, currency) : "",
  );

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await setManualPrice({
        itemId,
        price: String(formData.get("price") ?? ""),
        currency: pickedCurrency,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-3">
      <Field
        label="Currency"
        htmlFor="currency"
        hint={
          currencyLocked
            ? "Locked to the currency of existing transactions"
            : undefined
        }
      >
        <CurrencyPicker
          id="currency"
          name="currency"
          value={pickedCurrency}
          disabled={currencyLocked}
          onChange={(e) => setPickedCurrency(e.target.value)}
        />
      </Field>
      <Field label="Price per unit" htmlFor="price">
        <TextInput
          id="price"
          name="price"
          inputMode="decimal"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
        />
      </Field>
      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Update price"}
      </Button>
    </form>
  );
}
