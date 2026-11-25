/**
 * Where the money in stock sits, by tag, for the dashboard's concentration panel.
 *
 * A tag is a set when it is the catalogue name of some item's set ("ascended
 * heroes"), a kind of product when it names one ("etb", "slab", "booster box"), and
 * anything else is one of your own labels (often an old nickname for a set, like
 * "mega2.5"). Sets and kinds are shown on their own so each list adds up sensibly;
 * "all" shows every tag.
 */

import { looksLikeProduct } from "./set_tags";

export type ConcentrationView = "sets" | "types" | "all";

export type TagKind = "set" | "type" | "other";

export function classifyTag(tag: string, setTags: ReadonlySet<string>): TagKind {
  if (setTags.has(tag)) return "set";
  if (looksLikeProduct(tag)) return "type";
  return "other";
}

export type TagCost = { tag: string; inventoryCost: number; itemsHeld: number };

export type ConcentrationRow = {
  tag: string;
  kind: TagKind;
  cost: number;
  /** Share of everything held, at cost (0..1). Items with several tags count in each. */
  share: number;
  held: number;
};

/** The tags worth showing for a view, biggest first. Tags holding nothing are left out. */
export function concentrationRows(
  tags: readonly TagCost[],
  portfolioCost: number,
  setTags: ReadonlySet<string>,
  view: ConcentrationView,
): ConcentrationRow[] {
  if (!(portfolioCost > 0)) return [];
  const rows: ConcentrationRow[] = [];
  for (const t of tags) {
    if (!(t.inventoryCost > 0)) continue;
    const kind = classifyTag(t.tag, setTags);
    if (view === "sets" && kind !== "set") continue;
    if (view === "types" && kind !== "type") continue;
    rows.push({
      tag: t.tag,
      kind,
      cost: t.inventoryCost,
      share: Math.min(1, t.inventoryCost / portfolioCost),
      held: t.itemsHeld,
    });
  }
  return rows.sort((a, b) => b.cost - a.cost || a.tag.localeCompare(b.tag));
}

/** Tags in `all` that fall in no sets/types view: your own labels. */
export function otherTagCount(
  tags: readonly TagCost[],
  setTags: ReadonlySet<string>,
): number {
  return tags.filter((t) => t.inventoryCost > 0 && classifyTag(t.tag, setTags) === "other").length;
}
