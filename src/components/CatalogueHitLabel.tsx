import { ItemThumb } from "@/components/ItemThumb";
import { formatAmount } from "@/lib/currency";
import type { CatalogHit } from "@/lib/server/catalog_search";

/** One catalogue match: its picture, name, then set, language, card number and market price. */
export function CatalogueHitLabel({ hit }: { hit: CatalogHit }) {
  const detail = [
    hit.setName,
    hit.language === "ja" ? "Japanese" : null,
    hit.cardNumber,
    hit.kind === "card" ? "single card" : null,
  ].filter(Boolean);
  return (
    <span className="min-w-0 flex items-center gap-3 text-left">
      <ItemThumb imageUrl={hit.imageUrl} name={hit.name} size={40} />
      <span className="min-w-0 flex flex-col">
        <span className="truncate">{hit.name}</span>
        <span className="text-[11px] text-zinc-500 truncate">
          {detail.join(" · ")}
          {hit.marketUsdCents != null && hit.marketUsdCents > 0
            ? ` · ${formatAmount(hit.marketUsdCents, "USD")} on TCGplayer`
            : ""}
        </span>
      </span>
    </span>
  );
}
