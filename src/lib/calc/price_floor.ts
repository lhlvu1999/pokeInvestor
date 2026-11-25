/**
 * Where an item's market price stands against its price floor, the mirror of the
 * sell target: "tell me if this falls to or below X".
 *
 * It is a heads-up about a price you chose to watch, never a recommendation to
 * do anything. The floor and the price must be in the same currency to be
 * compared; a mismatch is reported as such and never converted, because a stale
 * exchange rate could fire (or hide) an alert that isn't real.
 */

export type FloorStanding =
  | { state: "none" }
  | { state: "no_price" }
  | { state: "currency_mismatch"; floorCurrency: string; priceCurrency: string }
  | {
      state: "reached";
      priceCents: number;
      floorCents: number;
      /** How far below the floor the price is (0.1 = 10% below; 0 = exactly at it). */
      belowBy: number;
    }
  | {
      state: "above";
      priceCents: number;
      floorCents: number;
      /** How much the price would have to fall to reach the floor (0.2 = it must drop 20%). */
      toFall: number;
    };

export function floorStanding(input: {
  floorCents: number | null;
  floorCurrency: string | null;
  priceCents: number | null;
  priceCurrency: string | null;
}): FloorStanding {
  const { floorCents, floorCurrency, priceCents, priceCurrency } = input;
  if (floorCents == null || floorCents <= 0) return { state: "none" };
  if (priceCents == null || priceCents <= 0 || !priceCurrency) return { state: "no_price" };
  if (floorCurrency !== priceCurrency) {
    return { state: "currency_mismatch", floorCurrency: floorCurrency ?? "", priceCurrency };
  }
  return priceCents <= floorCents
    ? { state: "reached", priceCents, floorCents, belowBy: 1 - priceCents / floorCents }
    : { state: "above", priceCents, floorCents, toFall: 1 - floorCents / priceCents };
}

/** The most the app accepts, matching the 32-bit column. */
export const MAX_FLOOR_CENTS = 2_000_000_000;

/**
 * A floor set relative to what you paid: `belowFraction` 0 is "at my cost", 0.2 is
 * "20% below my cost". Null when there is no cost to go on or the fraction makes
 * no sense.
 */
export function floorFromCost(avgCostCents: number, belowFraction: number): number | null {
  if (!Number.isFinite(avgCostCents) || avgCostCents <= 0) return null;
  if (!Number.isFinite(belowFraction) || belowFraction < 0 || belowFraction >= 1) return null;
  const cents = Math.round(avgCostCents * (1 - belowFraction));
  return cents > 0 && cents <= MAX_FLOOR_CENTS ? cents : null;
}

/** The preset choices on the item page, as fractions below cost. */
export const FLOOR_PRESETS = [
  { label: "At my cost", below: 0 },
  { label: "10% below my cost", below: 0.1 },
  { label: "20% below my cost", below: 0.2 },
] as const;

/** One held item as the bulk planner sees it. */
export type BulkFloorInput = {
  id: string;
  name: string;
  held: number;
  avgCostCents: number;
  /** The currency the item is bought and valued in. */
  currency: string;
  /** Already has a floor of its own: never overwritten in bulk. */
  hasFloor: boolean;
  priceCents: number | null;
  priceCurrency: string | null;
};

export type BulkFloorPlan = {
  id: string;
  name: string;
  floorCents: number;
  currency: string;
  /** Its latest price is already at or below this floor, so the next alert run would fire. */
  alertsNow: boolean;
};

/**
 * Which items would get a floor set from their cost, `belowFraction` below it.
 * Only items you hold, with a cost to go on, that have no floor yet.
 */
export function planBulkFloors(
  rows: BulkFloorInput[],
  belowFraction: number,
): { plans: BulkFloorPlan[]; alreadySet: number; noCost: number } {
  const plans: BulkFloorPlan[] = [];
  let alreadySet = 0;
  let noCost = 0;
  for (const r of rows) {
    if (r.held <= 0) continue;
    if (r.hasFloor) {
      alreadySet += 1;
      continue;
    }
    const floorCents = floorFromCost(r.avgCostCents, belowFraction);
    if (floorCents == null) {
      noCost += 1;
      continue;
    }
    const s = floorStanding({
      floorCents,
      floorCurrency: r.currency,
      priceCents: r.priceCents,
      priceCurrency: r.priceCurrency,
    });
    plans.push({
      id: r.id,
      name: r.name,
      floorCents,
      currency: r.currency,
      alertsNow: s.state === "reached",
    });
  }
  return { plans, alreadySet, noCost };
}
