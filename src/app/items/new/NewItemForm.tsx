"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createItem } from "@/lib/server/items";
import type { CatalogHit } from "@/lib/server/catalog_search";
import { useCatalogueSearch } from "@/components/useCatalogueSearch";
import { CatalogueHitLabel } from "@/components/CatalogueHitLabel";
import { useToast } from "@/components/Toast";
import { Button, ButtonLink, Card, Field, Textarea, TextInput } from "@/components/ui";

export function NewItemForm({ returnTo }: { returnTo: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // The catalogue entry this item is tied to, so it counts in its set's analytics.
  const [name, setName] = useState("");
  const [setCode, setSetCode] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [chosen, setChosen] = useState<CatalogHit | null>(null);
  const [unlinked, setUnlinked] = useState(false);
  const hits = useCatalogueSearch(name, !chosen && !unlinked);

  function choose(hit: CatalogHit) {
    setChosen(hit);
    // Fill only what is empty, so nothing the person typed is overwritten.
    if (!name.trim()) setName(hit.name);
    if (!setCode.trim() && hit.setAbbreviation) setSetCode(hit.setAbbreviation);
    if (!cardNumber.trim() && hit.cardNumber) setCardNumber(hit.cardNumber);
    if (!imageUrl.trim() && hit.imageUrl) setImageUrl(hit.imageUrl);
  }

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
        catalogProductId: chosen?.productId,
        autoLink: !chosen && !unlinked,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const link = res.data.link;
      toast.show({
        kind: "success",
        message: link
          ? `Created "${res.data.name}" and linked it to ${link.productName} (${link.setName}).`
          : `Created "${res.data.name}". It isn't linked to the catalogue yet.`,
      });
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
          <TextInput
            id="name"
            name="name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {chosen ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">
                Linked to the catalogue
              </span>
              <CatalogueHitLabel hit={chosen} />
            </span>
            <button
              type="button"
              className="shrink-0 text-xs text-sky-700 dark:text-sky-400 hover:underline"
              onClick={() => {
                setChosen(null);
                setUnlinked(true);
              }}
            >
              Remove link
            </button>
          </div>
        ) : hits.length > 0 ? (
          <div className="flex flex-col gap-1 -mt-2">
            <div className="text-xs text-zinc-500">
              In the catalogue — pick one to link this item to its set:
            </div>
            <ul className="rounded-md border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
              {hits.map((h) => (
                <li key={h.productId}>
                  <button
                    type="button"
                    onClick={() => choose(h)}
                    className="w-full px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <CatalogueHitLabel hit={h} />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="self-start text-xs text-zinc-500 hover:underline"
              onClick={() => setUnlinked(true)}
            >
              None of these
            </button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Set code" htmlFor="setCode">
            <TextInput
              id="setCode"
              name="setCode"
              placeholder="BASE1"
              value={setCode}
              onChange={(e) => setSetCode(e.target.value)}
            />
          </Field>
          <Field label="Card number" htmlFor="cardNumber">
            <TextInput
              id="cardNumber"
              name="cardNumber"
              placeholder="4/102"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Image URL" htmlFor="imageUrl">
          <TextInput
            id="imageUrl"
            name="imageUrl"
            type="url"
            placeholder="https://..."
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
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
