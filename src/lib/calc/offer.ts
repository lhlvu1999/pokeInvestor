/**
 * Offer-sheet arithmetic: price a block of held items at a percentage of
 * market, and describe the result for a buyer.
 *
 * Everything is in integer minor units of one currency. The numbers split
 * into two audiences and must never be mixed up on output:
 *
 *   buyer-facing:  market, offer each, line total, offer total, buyer saves
 *   private:       cost, profit (never on the sheet or in the copied text)
 */

import { formatAmount } from "@/lib/currency";

export type OfferLine = {
  itemId: string;
  name: string;
  quantity: number;
  /** Latest market price per unit. */
  marketUnit: number;
  /** Average cost per held unit — private. */
  avgCost: number;
  /** Per-unit offer after rounding or a manual override. */
  offerUnit: number;
};

/**
 * Offer per unit: `pct`% of market, then rounded to the nearest `step`
 * (a step of 1 means "no extra rounding"). Round numbers read as an offer
 * a person would actually make ("₫2,520,000", not "₫2,519,918").
 */
export function offerUnitPrice(
  marketUnit: number,
  pct: number,
  step = 1,
): number {
  if (marketUnit <= 0 || pct <= 0) return 0;
  const exact = (marketUnit * pct) / 100;
  const s = Math.max(1, Math.round(step));
  return Math.round(exact / s) * s;
}

export type OfferTotals = {
  /** Σ market × qty — what the lot is worth at market. */
  reference: number;
  /** Σ offer × qty — what the buyer pays. */
  offer: number;
  /** reference − offer: the discount the buyer gets. */
  buyerSaves: number;
  /** Private: Σ cost × qty. */
  cost: number;
  /** Private: offer − cost. */
  profit: number;
  /** offer ÷ reference as a percentage; null for an empty lot. */
  effectivePct: number | null;
  units: number;
};

export function offerTotals(lines: ReadonlyArray<OfferLine>): OfferTotals {
  let reference = 0;
  let offer = 0;
  let cost = 0;
  let units = 0;
  for (const l of lines) {
    reference += l.marketUnit * l.quantity;
    offer += l.offerUnit * l.quantity;
    cost += l.avgCost * l.quantity;
    units += l.quantity;
  }
  return {
    reference,
    offer,
    buyerSaves: reference - offer,
    cost,
    profit: offer - cost,
    effectivePct: reference > 0 ? (offer / reference) * 100 : null,
    units,
  };
}

/** True when selling at this offer loses money against what you paid. */
export function isBelowCost(l: OfferLine): boolean {
  return l.avgCost > 0 && l.offerUnit < l.avgCost;
}

/** Percentage of market a unit offer represents, rounded to a whole number. */
export function pctOfMarket(offerUnit: number, marketUnit: number): number {
  if (marketUnit <= 0) return 0;
  return Math.round((offerUnit / marketUnit) * 100);
}

/**
 * Rounding choices for a currency, as minor-unit steps with labels. Zero-
 * decimal currencies (VND, JPY) get thousand-scale steps; others get whole
 * units and small round amounts.
 */
export function roundingSteps(
  exponent: number,
): { label: string; step: number }[] {
  const unit = 10 ** exponent;
  if (exponent === 0) {
    return [
      { label: "Exact", step: 1 },
      { label: "1,000", step: 1_000 },
      { label: "10,000", step: 10_000 },
      { label: "100,000", step: 100_000 },
    ];
  }
  return [
    { label: "Exact", step: 1 },
    { label: "1", step: unit },
    { label: "5", step: 5 * unit },
    { label: "10", step: 10 * unit },
  ];
}

/**
 * The copyable message. Buyer-safe by construction: it is built only from
 * the buyer-facing fields of `OfferLine`, so there is no path for cost or
 * profit to leak into it.
 */
export function offerText(
  lines: ReadonlyArray<OfferLine>,
  currency: string,
  dateLabel: string,
): string {
  const t = offerTotals(lines);
  const out: string[] = [`Offer · ${dateLabel}`, ""];
  lines.forEach((l, i) => {
    const pct = pctOfMarket(l.offerUnit, l.marketUnit);
    out.push(`${i + 1}. ${l.name} ×${l.quantity}`);
    out.push(
      `   ${formatAmount(l.offerUnit, currency)} each (${pct}% of market ${formatAmount(l.marketUnit, currency)}) = ${formatAmount(l.offerUnit * l.quantity, currency)}`,
    );
  });
  out.push("");
  out.push(
    `Total: ${formatAmount(t.offer, currency)} for ${t.units} unit${t.units === 1 ? "" : "s"}`,
  );
  if (t.reference > 0) {
    out.push(
      `Market value: ${formatAmount(t.reference, currency)} · you save ${formatAmount(t.buyerSaves, currency)}`,
    );
  }
  return out.join("\n");
}
