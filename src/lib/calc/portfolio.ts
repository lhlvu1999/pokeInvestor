/**
 * Aggregate per-item *display-currency* values into a portfolio summary.
 * Values must already be converted to a single currency before being passed in.
 */

export type ConvertedItemValues = {
  inventoryCost: number;
  marketValue: number;
  realized: number;
  unrealized: number;
  quantity: number;
  /** Lifetime cost of all buys for this item (display currency, minor units). */
  totalSpent: number;
  /** Lifetime received from all sells for this item (display currency, minor units). */
  totalReceived: number;
};

export type PortfolioSummary = {
  invested: number;
  currentValue: number;
  realized: number;
  unrealized: number;
  total: number;
  itemsHeld: number;
};

export function summarizePortfolio(
  values: ReadonlyArray<ConvertedItemValues>,
): PortfolioSummary {
  let invested = 0;
  let currentValue = 0;
  let realized = 0;
  let unrealized = 0;
  let itemsHeld = 0;

  for (const v of values) {
    invested += v.inventoryCost;
    currentValue += v.marketValue;
    realized += v.realized;
    unrealized += v.unrealized;
    if (v.quantity > 0) itemsHeld += 1;
  }

  return {
    invested,
    currentValue,
    realized,
    unrealized,
    total: realized + unrealized,
    itemsHeld,
  };
}
