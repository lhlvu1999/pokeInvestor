/**
 * Loader for the "how this set is tracking" card on a set's page: compares the
 * set's own history, and its sealed products, with earlier sets at the same
 * age. A pure read (no "use server").
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bulkReleaseDates } from "@/lib/calc/set_list";
import { trackSet, type SetTracking } from "@/lib/calc/set_tracking";
import { getAgedSets } from "@/lib/server/catalog_insights";
import {
  getLifecycles,
  type ProductLifecycle,
} from "@/lib/server/catalog_lifecycle";
import type { SetHistoryPoint } from "@/lib/server/catalog_sets";

export type SetTrackingData = {
  tracking: SetTracking;
  /** The release date used (YYYY-MM-DD), or null when it can't be trusted. */
  releasedOn: string | null;
  /** The set's boxes, trainer boxes, bundles and packs, with their lifecycles. */
  products: ProductLifecycle[];
  /** First day of the set's price history, when it has any. */
  historyStart: string | null;
};

export async function getSetTracking(args: {
  groupId: number;
  language: "en" | "ja";
  publishedOn: string | null;
  history: ReadonlyArray<SetHistoryPoint>;
  sealedProductIds: ReadonlyArray<number>;
}): Promise<SetTrackingData> {
  const { groupId, language, history, sealedProductIds } = args;

  // A date many sets share is a bookkeeping stamp, not a release.
  const dates = await db.execute<{ d: string | null }>(sql`
    SELECT to_char(published_on, 'YYYY-MM-DD') AS d FROM catalog_sets
  `);
  const bulk = bulkReleaseDates(dates.map((r) => r.d));
  const published = args.publishedOn ? args.publishedOn.slice(0, 10) : null;
  const releasedOn = published && !bulk.has(published) ? published : null;

  const [cohort, lifecycles] = await Promise.all([
    getAgedSets(),
    getLifecycles(sealedProductIds),
  ]);

  const tracking = trackSet(
    {
      groupId,
      language,
      releasedOn,
      days: history.map((h) => ({
        day: h.day,
        priced: h.pricedCount,
        top20: h.top20Cents,
        top10: h.top10Cents,
        total: h.totalCents,
      })),
    },
    cohort,
  );

  const products = [...lifecycles.values()]
    .filter((p) => p.kind != null && p.ageDays != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    tracking,
    releasedOn,
    products,
    historyStart: history.length > 0 ? history[0].day : null,
  };
}
