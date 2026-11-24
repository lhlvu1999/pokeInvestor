/**
 * Where an item's market price stands against its sell target.
 *
 * The target and the price must be in the same currency to be compared; the
 * app has exchange rates but a stale one could fire (or hide) an alert that
 * isn't real, so a mismatch is reported as such and never converted.
 */

export type TargetStanding =
  | { state: "none" }
  | { state: "no_price" }
  | { state: "currency_mismatch"; targetCurrency: string; priceCurrency: string }
  | {
      state: "reached";
      priceCents: number;
      targetCents: number;
      /** How far above the target the price is (0.1 = 10% above). */
      aboveBy: number;
    }
  | {
      state: "below";
      priceCents: number;
      targetCents: number;
      /** How much the price has to rise to reach the target (0.2 = +20%). */
      toGo: number;
    };

export function sellTargetStanding(input: {
  targetCents: number | null;
  targetCurrency: string | null;
  priceCents: number | null;
  priceCurrency: string | null;
}): TargetStanding {
  const { targetCents, targetCurrency, priceCents, priceCurrency } = input;
  if (targetCents == null || targetCents <= 0) return { state: "none" };
  if (priceCents == null || priceCents <= 0 || !priceCurrency) {
    return { state: "no_price" };
  }
  if (targetCurrency !== priceCurrency) {
    return {
      state: "currency_mismatch",
      targetCurrency: targetCurrency ?? "",
      priceCurrency,
    };
  }
  return priceCents >= targetCents
    ? {
        state: "reached",
        priceCents,
        targetCents,
        aboveBy: priceCents / targetCents - 1,
      }
    : {
        state: "below",
        priceCents,
        targetCents,
        toGo: targetCents / priceCents - 1,
      };
}
