/**
 * Helpers for the "new transaction" form's price hints.
 *
 * The form's cost field is the TOTAL for the whole transaction, so a
 * per-unit price is only useful once it is multiplied by the quantity
 * being entered. These keep that arithmetic out of the component.
 */

type BuyLike = {
  type: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  shippingCents: number | null;
  occurredAt: Date;
};

/**
 * Per-unit ITEM cost of the most recent buy, excluding shipping (shipping
 * has its own field in the form, so including it would double-count).
 * Null when there is no usable buy.
 */
export function lastBuyPerUnit(txs: ReadonlyArray<BuyLike>): number | null {
  let latest: BuyLike | null = null;
  for (const t of txs) {
    if (t.type !== "buy" || t.quantity <= 0) continue;
    if (!latest || t.occurredAt.getTime() > latest.occurredAt.getTime()) {
      latest = t;
    }
  }
  if (!latest) return null;
  const itemOnly = latest.finalValueCents - (latest.shippingCents ?? 0);
  if (itemOnly <= 0) return null;
  return Math.round(itemOnly / latest.quantity);
}

/**
 * Total for `quantity` units at `perUnitMinor`, or null when either input
 * isn't usable (no price, zero or fractional quantity mid-typing).
 */
export function suggestedTotal(
  perUnitMinor: number | null | undefined,
  quantity: number,
): number | null {
  if (perUnitMinor == null || perUnitMinor <= 0) return null;
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  return perUnitMinor * quantity;
}
