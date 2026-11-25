/**
 * What you hold in one catalogue set, added up from its items.
 *
 * An item belongs to a set through its catalogue link (a sealed product) or, for a
 * graded slab, through the card it was matched to. Only items you still hold count
 * toward the totals; items you have sold out of are counted apart so they are not
 * lost from view.
 */

export type SetItemInput = {
  id: string;
  name: string;
  imageUrl: string | null;
  /** Units in hand. */
  units: number;
  /** Cost of the units in hand, in the display currency. */
  cost: number;
  /** Market value of the units in hand, in the display currency (0 when unpriced). */
  value: number;
  hasPrice: boolean;
};

export type SetHoldingItem = SetItemInput & {
  /** This item's share of the set's priced value you hold (0..1), or null when unpriced. */
  shareOfValue: number | null;
};

export type SetHoldingsSummary = {
  /** Items you still hold, biggest value first (unpriced ones by cost, after the priced). */
  held: SetHoldingItem[];
  /** Items linked to the set that you no longer hold. */
  soldOut: number;
  units: number;
  cost: number;
  /** Value of the priced items you hold. */
  value: number;
  /** Cost of held items with no price, so they are left out of `value`. */
  unpricedCost: number;
  /** Held items with no price. */
  unpriced: number;
};

export function summarizeSetHoldings(rows: readonly SetItemInput[]): SetHoldingsSummary {
  const heldRows = rows.filter((r) => r.units > 0);
  const value = heldRows.reduce((s, r) => s + (r.hasPrice ? r.value : 0), 0);
  const held: SetHoldingItem[] = heldRows
    .map((r) => ({
      ...r,
      shareOfValue: r.hasPrice && value > 0 ? r.value / value : null,
    }))
    .sort(
      (a, b) =>
        Number(b.hasPrice) - Number(a.hasPrice) ||
        (b.hasPrice ? b.value - a.value : b.cost - a.cost) ||
        a.name.localeCompare(b.name),
    );
  return {
    held,
    soldOut: rows.length - heldRows.length,
    units: heldRows.reduce((s, r) => s + r.units, 0),
    cost: heldRows.reduce((s, r) => s + r.cost, 0),
    value,
    unpricedCost: heldRows.reduce((s, r) => s + (r.hasPrice ? 0 : r.cost), 0),
    unpriced: heldRows.filter((r) => !r.hasPrice).length,
  };
}
