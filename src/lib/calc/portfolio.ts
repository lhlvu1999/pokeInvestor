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
  /**
   * Whether this item has a market price at all.
   *
   * Cannot be inferred from `marketValue > 0`: an unpriced item and a
   * genuinely worthless one both read as zero, and conflating them makes
   * the coverage stats lie.
   */
  hasPrice: boolean;
};

export type PortfolioSummary = {
  /** Inventory cost across ALL held items, priced or not. */
  invested: number;
  /** Market value. Only priced items contribute — unpriced ones add 0. */
  currentValue: number;
  realized: number;
  unrealized: number;
  total: number;
  itemsHeld: number;

  /* ── Price coverage ──────────────────────────────────────────────────
   * `invested` covers every held item but `currentValue` can only cover
   * the priced ones, so comparing them directly overstates a loss. These
   * fields let the UI show the comparable pair and disclose the gap. */

  /** Held items that have a market price. */
  pricedItemsHeld: number;
  /** Held items with no market price — excluded from `currentValue`. */
  unpricedItemsHeld: number;
  /** Inventory cost of priced held items only. This is the apples-to-
   * apples counterpart to `currentValue`. */
  investedPriced: number;
  /** Inventory cost locked up in held items we cannot value. */
  investedUnpriced: number;
};

export function summarizePortfolio(
  values: ReadonlyArray<ConvertedItemValues>,
): PortfolioSummary {
  let invested = 0;
  let currentValue = 0;
  let realized = 0;
  let unrealized = 0;
  let itemsHeld = 0;
  let pricedItemsHeld = 0;
  let unpricedItemsHeld = 0;
  let investedPriced = 0;
  let investedUnpriced = 0;

  for (const v of values) {
    invested += v.inventoryCost;
    currentValue += v.marketValue;
    realized += v.realized;
    unrealized += v.unrealized;
    if (v.quantity > 0) {
      itemsHeld += 1;
      if (v.hasPrice) {
        pricedItemsHeld += 1;
        investedPriced += v.inventoryCost;
      } else {
        unpricedItemsHeld += 1;
        investedUnpriced += v.inventoryCost;
      }
    }
  }

  return {
    invested,
    currentValue,
    realized,
    unrealized,
    total: realized + unrealized,
    itemsHeld,
    pricedItemsHeld,
    unpricedItemsHeld,
    investedPriced,
    investedUnpriced,
  };
}
