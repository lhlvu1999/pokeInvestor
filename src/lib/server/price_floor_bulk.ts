"use server";

/**
 * Set price floors from cost for every held item that has none yet (admin tool).
 * It never overwrites a floor you set yourself. Previews first; applying is a
 * separate call that recomputes from the data at that moment.
 */

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import { planBulkFloors, type BulkFloorInput } from "@/lib/calc/price_floor";
import { listItemsWithValuations } from "@/lib/server/items";
import type { ActionResult } from "./items";

export type BulkFloorPreview = {
  count: number;
  alertsNow: number;
  alreadySet: number;
  noCost: number;
  sample: { id: string; name: string; floorCents: number; currency: string; alertsNow: boolean }[];
};

/** Accepts only the fractions the UI offers, so a tampered request can't set odd floors. */
function fractionFor(belowPercent: number): number | null {
  return [0, 10, 20].includes(belowPercent) ? belowPercent / 100 : null;
}

async function plan(belowPercent: number) {
  const fraction = fractionFor(belowPercent);
  if (fraction == null) return null;
  const all = await listItemsWithValuations();
  const rows: BulkFloorInput[] = all.map(({ item, valuation, latestPrice }) => ({
    id: item.id,
    name: item.name,
    held: valuation.quantity,
    avgCostCents: valuation.avgCostCents,
    currency: valuation.currency,
    hasFloor: item.floorCents != null,
    priceCents: latestPrice?.priceCents ?? null,
    priceCurrency: latestPrice?.currency ?? null,
  }));
  return planBulkFloors(rows, fraction);
}

export async function previewBulkFloors(
  belowPercent: number,
): Promise<ActionResult<BulkFloorPreview>> {
  const p = await plan(belowPercent);
  if (!p) return { ok: false, error: "Choose one of the offered levels." };
  return {
    ok: true,
    data: {
      count: p.plans.length,
      alertsNow: p.plans.filter((x) => x.alertsNow).length,
      alreadySet: p.alreadySet,
      noCost: p.noCost,
      sample: p.plans.slice(0, 8),
    },
  };
}

export async function applyBulkFloors(
  belowPercent: number,
): Promise<ActionResult<{ set: number }>> {
  const p = await plan(belowPercent);
  if (!p) return { ok: false, error: "Choose one of the offered levels." };
  // Each update only lands while the item still has no floor, so a floor you save
  // between the preview and this call is never overwritten.
  let set = 0;
  await db.transaction(async (tx) => {
    for (const x of p.plans) {
      const done = await tx
        .update(items)
        .set({ floorCents: x.floorCents, floorCurrency: x.currency, floorAlertedAt: null })
        .where(and(eq(items.id, x.id), isNull(items.floorCents)))
        .returning({ id: items.id });
      set += done.length;
    }
  });
  revalidatePath("/", "layout");
  return { ok: true, data: { set } };
}
