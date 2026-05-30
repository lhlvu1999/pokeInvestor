"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createItem } from "@/lib/server/items";
import { Button, ButtonLink, Card, Field, Textarea, TextInput } from "@/components/ui";

export function NewItemForm({ returnTo }: { returnTo: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createItem({
        name: String(formData.get("name") ?? ""),
        setCode: String(formData.get("setCode") ?? ""),
        cardNumber: String(formData.get("cardNumber") ?? ""),
        imageUrl: String(formData.get("imageUrl") ?? ""),
        sourceUrl: String(formData.get("sourceUrl") ?? ""),
        pricechartingId: String(formData.get("pricechartingId") ?? ""),
        note: String(formData.get("note") ?? ""),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const dest = returnTo
        ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}itemId=${res.data.id}`
        : `/items/${res.data.id}`;
      router.push(dest);
      router.refresh();
    });
  }

  return (
    <Card className="p-5">
      <form action={onSubmit} className="flex flex-col gap-4">
        <Field label="Name" htmlFor="name" hint="e.g. Charizard 4/102 Base Set">
          <TextInput id="name" name="name" required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Set code" htmlFor="setCode">
            <TextInput id="setCode" name="setCode" placeholder="BASE1" />
          </Field>
          <Field label="Card number" htmlFor="cardNumber">
            <TextInput
              id="cardNumber"
              name="cardNumber"
              placeholder="4/102"
            />
          </Field>
        </div>
        <Field label="Image URL" htmlFor="imageUrl">
          <TextInput
            id="imageUrl"
            name="imageUrl"
            type="url"
            placeholder="https://..."
          />
        </Field>
        <Field
          label="Reference URL"
          htmlFor="sourceUrl"
          hint="e.g. TCGPlayer product page — shown as a one-click link on the item"
        >
          <TextInput
            id="sourceUrl"
            name="sourceUrl"
            type="url"
            placeholder="https://www.tcgplayer.com/product/..."
          />
        </Field>
        <Field
          label="PriceCharting product ID"
          htmlFor="pricechartingId"
          hint="Numeric ID from a PriceCharting product page — enables 'Refresh price' on this item"
        >
          <TextInput
            id="pricechartingId"
            name="pricechartingId"
            placeholder="e.g. 123456"
          />
        </Field>
        <Field label="Note" htmlFor="note">
          <Textarea id="note" name="note" rows={3} />
        </Field>

        {error && (
          <div className="text-sm text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 justify-end">
          <ButtonLink href="/items" variant="secondary">
            Cancel
          </ButtonLink>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save item"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
