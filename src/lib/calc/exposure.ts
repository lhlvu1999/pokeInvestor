/**
 * What your stock is made of: how its value splits by set, kind of product
 * and language, and how concentrated it is.
 *
 * Value is market value where the item has a market price, and what you paid
 * where it doesn't (flagged, never hidden), the same as the dashboard's
 * annualized return treats unpriced stock.
 */

export type Holding = {
  itemId: string;
  name: string;
  /** Value in the display currency (minor units). */
  value: number;
  /** True when `value` is cost because the item has no market price. */
  atCost: boolean;
  /** "box" | "etb" | "bundle" | "pack", or "other" (linked, another kind) or "unlinked". */
  kind: string;
  language: "en" | "ja" | null;
  setId: number | null;
  setName: string | null;
};

export type Slice = {
  key: string;
  label: string;
  value: number;
  /** Share of all the stock's value, 0–1. */
  share: number;
  items: number;
  /** How much of this slice's value is at cost (no market price). */
  atCostValue: number;
};

/** Split holdings into slices by a key, biggest first. Zero or negative values are ignored. */
export function sliceBy(
  holdings: ReadonlyArray<Holding>,
  by: (h: Holding) => { key: string; label: string },
): Slice[] {
  const total = holdings.reduce((a, h) => a + Math.max(0, h.value), 0);
  const map = new Map<string, Slice>();
  for (const h of holdings) {
    if (!(h.value > 0)) continue;
    const { key, label } = by(h);
    const s = map.get(key) ?? {
      key,
      label,
      value: 0,
      share: 0,
      items: 0,
      atCostValue: 0,
    };
    s.value += h.value;
    s.items += 1;
    if (h.atCost) s.atCostValue += h.value;
    map.set(key, s);
  }
  return [...map.values()]
    .map((s) => ({ ...s, share: total > 0 ? s.value / total : 0 }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export type Concentration = {
  total: number;
  items: number;
  /** Share held in the single biggest item, 0–1. */
  top1: number;
  /** Share held in the five biggest items, 0–1. */
  top5: number;
};

export function concentration(holdings: ReadonlyArray<Holding>): Concentration {
  const values = holdings
    .map((h) => h.value)
    .filter((v) => v > 0)
    .sort((a, b) => b - a);
  const total = values.reduce((a, v) => a + v, 0);
  const sum = (n: number) => values.slice(0, n).reduce((a, v) => a + v, 0);
  return {
    total,
    items: values.length,
    top1: total > 0 ? sum(1) / total : 0,
    top5: total > 0 ? sum(5) / total : 0,
  };
}
