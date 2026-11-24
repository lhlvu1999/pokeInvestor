/**
 * Where each watched product is in its life, and the usual low for its kind,
 * for the watchlist page. A pure read (no "use server").
 */

import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import type { Lifecycle } from "@/lib/calc/lifecycle";
import type { SealedType } from "@/lib/calc/sealed_type";
import { atUsualLow, usualLow, type UsualLow } from "@/lib/calc/usual_low";
import { getAgedProducts } from "@/lib/server/catalog_insights";
import { getLifecycles } from "@/lib/server/catalog_lifecycle";
import type { WatchlistRow } from "@/lib/server/watchlist";

export type StageInfo = {
  productName: string;
  kind: SealedType | null;
  language: "en" | "ja";
  ageDays: number | null;
  /** The product's own move since day 7 (or release), when known. */
  own: Lifecycle["own"];
  /** The usual low for its kind, if its kind has one. */
  low: UsualLow | null;
  /** True when the product is within the window around that low. */
  atLow: boolean;
};

/** Stage info by watchlist entry id, for entries linked to a catalogue product. */
export async function getStageInfos(
  rows: ReadonlyArray<WatchlistRow>,
): Promise<Map<string, StageInfo>> {
  const out = new Map<string, StageInfo>();
  const itemIds = rows
    .map((r) => r.entry.itemId)
    .filter((id): id is string => id != null);
  if (itemIds.length === 0) return out;

  const linked = await db
    .select({ id: items.id, productId: items.catalogProductId })
    .from(items)
    .where(inArray(items.id, itemIds));
  const productOf = new Map(
    linked.filter((l) => l.productId != null).map((l) => [l.id, Number(l.productId)]),
  );
  const [lifecycles, cohort] = await Promise.all([
    getLifecycles([...productOf.values()]),
    getAgedProducts(),
  ]);

  for (const r of rows) {
    const productId = r.entry.itemId ? productOf.get(r.entry.itemId) : undefined;
    const life = productId != null ? lifecycles.get(productId) : undefined;
    if (!life) continue;
    const low = life.kind ? usualLow(cohort, life.kind, life.language) : null;
    out.set(r.entry.id, {
      productName: life.name,
      kind: life.kind,
      language: life.language,
      ageDays: life.ageDays,
      own: life.own,
      low,
      atLow: low != null && life.ageDays != null && atUsualLow(life.ageDays, low),
    });
  }
  return out;
}

