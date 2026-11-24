/**
 * Loader for the release calendar: sets coming up and sets just out, each with
 * its sealed products' latest prices and what earlier launches did from the
 * same point. A pure read (no "use server").
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { AGES, nearestAge } from "@/lib/calc/age_curve";
import {
  buildLifecycle,
  type Lifecycle,
  type Position,
} from "@/lib/calc/lifecycle";
import { launchPath, type LaunchStep } from "@/lib/calc/launch_path";
import { splitCalendar, type CalendarSet } from "@/lib/calc/release_calendar";
import { SEALED_TYPES, type SealedType } from "@/lib/calc/sealed_type";
import { bulkReleaseDates } from "@/lib/calc/set_list";
import { getAgedProducts } from "@/lib/server/catalog_insights";
import { loadLifecycleInputs } from "@/lib/server/catalog_lifecycle";

export type CalendarProduct = {
  productId: number;
  name: string;
  kind: SealedType;
  /** Newest market price (US cents), when there's a recent one. */
  priceCents: number | null;
  /** The age (days since release) the comparison starts from. */
  fromAge: number | null;
  /** What earlier launches did from that age. */
  steps: LaunchStep[];
  /** For sets already out: the product's own move and where it sits. */
  own: Lifecycle["own"];
  typical: Lifecycle["typical"];
  position: Position | null;
};

export type CalendarSetRow = CalendarSet & {
  releasedOn: string;
  daysAway: number;
  sealedCount: number;
  /** Boxes, trainer boxes, bundles and packs, priced ones first. */
  products: CalendarProduct[];
  /** Sealed products that aren't one of those four kinds. */
  otherProducts: number;
};

export type ReleaseCalendar = {
  /** Newest catalogue price day (YYYY-MM-DD). */
  today: string | null;
  upcoming: CalendarSetRow[];
  recent: CalendarSetRow[];
};

/**
 * Further out than this before release, past launches have no price to
 * compare with (they first get one about 60 days out).
 */
export const TOO_EARLY_DAYS = 65;

type SetRow = {
  group_id: string;
  name: string;
  language: string;
  rel: string | null;
};
type ProdRow = { product_id: string; group_id: string };

const KIND_ORDER = new Map(SEALED_TYPES.map((k, i) => [k, i]));

export async function getReleaseCalendar(): Promise<ReleaseCalendar> {
  const dayRow = await db.execute<{ day: string | null }>(sql`
    SELECT to_char(max(day), 'YYYY-MM-DD') AS day FROM catalog_set_daily
  `);
  const today = dayRow[0]?.day ?? null;
  if (!today) return { today: null, upcoming: [], recent: [] };

  const setRows = await db.execute<SetRow>(sql`
    SELECT group_id::text AS group_id, name, language,
           to_char(published_on, 'YYYY-MM-DD') AS rel
      FROM catalog_sets WHERE published_on IS NOT NULL
  `);
  // A date many sets share is a bookkeeping stamp, not a release.
  const bulk = bulkReleaseDates(setRows.map((r) => r.rel));
  const sets: CalendarSet[] = setRows.map((r) => ({
    groupId: Number(r.group_id),
    name: r.name,
    language: r.language === "ja" ? "ja" : "en",
    releasedOn: r.rel,
  }));
  const cal = splitCalendar(sets, today, { bulk });
  const groups = [...cal.upcoming, ...cal.recent].map((s) => s.groupId);
  if (groups.length === 0) return { today, upcoming: [], recent: [] };

  const prodRows = await db.execute<ProdRow>(sql`
    SELECT product_id::text AS product_id, group_id::text AS group_id
      FROM catalog_products
     WHERE kind = 'sealed' AND group_id IN (
       SELECT jsonb_array_elements_text(${JSON.stringify(groups)}::jsonb)::bigint)
  `);
  const [inputs, cohort] = await Promise.all([
    loadLifecycleInputs(prodRows.map((r) => Number(r.product_id))),
    getAgedProducts(),
  ]);

  const byGroup = new Map<number, typeof inputs>();
  for (const p of inputs) {
    const list = byGroup.get(p.input.groupId) ?? [];
    list.push(p);
    byGroup.set(p.input.groupId, list);
  }

  const build = (s: (typeof cal.upcoming)[number]): CalendarSetRow => {
    const all = byGroup.get(s.groupId) ?? [];
    const products: CalendarProduct[] = [];
    for (const p of all) {
      const kind = p.input.kind;
      if (!kind) continue;
      const life = buildLifecycle(p.input, cohort);
      const age = life.ageDays;
      // Past launches have prices from about 60 days before release; a
      // product further out than that has nothing honest to compare with.
      const tooEarly = age != null && age < -TOO_EARLY_DAYS;
      const fromAge =
        age == null || tooEarly ? null : nearestAge(Math.max(AGES[0], age));
      products.push({
        productId: p.productId,
        name: p.name,
        kind,
        priceCents: p.input.latest?.cents ?? null,
        fromAge,
        steps:
          fromAge == null
            ? []
            : launchPath(cohort, {
                kind,
                language: p.input.language,
                fromAge,
                excludeGroupId: s.groupId,
                targets: [0, 7, 30, 90],
              }),
        own: life.own,
        typical: life.typical,
        position: life.position,
      });
    }
    products.sort(
      (a, b) =>
        Number(b.priceCents != null) - Number(a.priceCents != null) ||
        (KIND_ORDER.get(a.kind) ?? 9) - (KIND_ORDER.get(b.kind) ?? 9) ||
        a.name.localeCompare(b.name),
    );
    return {
      ...s,
      sealedCount: all.length,
      products,
      otherProducts: all.filter((p) => !p.input.kind).length,
    };
  };

  return {
    today,
    upcoming: cal.upcoming.map(build),
    // A set that came out with nothing sealed listed (promos, mostly) has
    // nothing to show, so it stays off the "just out" list.
    recent: cal.recent.map(build).filter((s) => s.sealedCount > 0),
  };
}

export type PreorderRow = {
  kind: SealedType;
  /** Days before release the comparison starts from (negative). */
  fromAge: number;
  steps: LaunchStep[];
};

/** Pre-order starting points shown in the history table. */
export const PREORDER_STARTS = [-60, -30, -7] as const;

/**
 * How English pre-orders have moved: for each kind of product, from 60 days,
 * 30 days and a week before release, the typical change by release day, a
 * month on and three months on. English only, because Japanese products
 * aren't priced before release.
 */
export async function getPreorderHistory(): Promise<PreorderRow[]> {
  const cohort = await getAgedProducts();
  const rows: PreorderRow[] = [];
  for (const kind of SEALED_TYPES) {
    for (const fromAge of PREORDER_STARTS) {
      rows.push({
        kind,
        fromAge,
        steps: launchPath(cohort, {
          kind,
          language: "en",
          fromAge,
          targets: [0, 30, 90],
        }),
      });
    }
  }
  return rows;
}
