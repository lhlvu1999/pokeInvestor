/**
 * Loaders for the Set insights page: market indexes built from the stored
 * daily history, and sealed prices at fixed ages after release. Pure reads
 * (no "use server"); both are heavy enough to cache for a while, and the
 * underlying data only changes once a day.
 *
 * How the typical daily change is measured: the geometric mean (the average
 * of log changes) over everything priced on both days. A plain average of
 * price ratios drifts upward on day-to-day wobble alone (100 → 105 → 100
 * averages +0.1% a day); logs cancel that. A single day's move beyond 2x
 * either way is treated as a data glitch and left out (one Hidden Fates
 * Elite Trainer Box dropping from $284 to $1 would otherwise take 8% off the
 * ETB index). Nothing else is trimmed: most prices don't move on a given day
 * and rises outnumber falls, so trimming the tails symmetrically cuts out the
 * real drift (it was tried, and the index came out far below what the same
 * products actually did). A median was rejected too, as it sits at exactly 0.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { AGES, type AgedProduct } from "@/lib/calc/age_curve";
import { cachedAsync } from "@/lib/calc/cached";
import type { AgedSet } from "@/lib/calc/card_curve";
import { bulkReleaseDates } from "@/lib/calc/set_list";
import {
  INDEX_METRIC_VALUES,
  type IndexMetric,
} from "@/lib/calc/insight_params";
import {
  blendChanges,
  chainIndex,
  type DailyChange,
  type IndexPoint,
} from "@/lib/calc/market_index";
import {
  SEALED_TYPES,
  sealedType,
  type SealedType,
} from "@/lib/calc/sealed_type";

export type Language = "en" | "ja";

export { type IndexMetric };

export type IndexSeries = {
  metric: IndexMetric;
  language: Language;
  points: IndexPoint[];
  /** Typical number of sets or products behind each day's change. */
  typicalN: number;
};

export type MarketIndexes = {
  /** Newest price day in the catalogue (YYYY-MM-DD). */
  asOf: string | null;
  series: IndexSeries[];
};

/** Sets need at least this many priced cards to be part of an index. */
const MIN_PRICED_CARDS = 20;

/** A one-day move beyond this multiple (up or down) is a data glitch. */
const MAX_DAILY_MOVE = 2;

type ChangeRow = {
  day: string;
  language: string;
  grp: string;
  n: string | number;
  change: string | number | null;
};

function toChanges(rows: ChangeRow[]): Map<string, DailyChange[]> {
  const out = new Map<string, DailyChange[]>();
  for (const r of rows) {
    const key = `${r.grp}:${r.language}`;
    const list = out.get(key) ?? [];
    list.push({
      day: r.day,
      change: r.change == null ? null : Number(r.change),
      n: Number(r.n),
    });
    out.set(key, list);
  }
  return out;
}

function typical(changes: DailyChange[]): number {
  if (changes.length === 0) return 0;
  const sorted = changes.map((c) => c.n).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function computeMarketIndexes(): Promise<MarketIndexes> {
  // Sets: each set's change in total value and in its top 20, counted only on
  // days its priced-card count is the same as the day before, so a card
  // gaining a price can't pass for a price move.
  const sets = await db.execute<ChangeRow>(sql`
    WITH s AS (
      SELECT d.group_id, d.day, d.priced_count, d.total_cents, d.top20_cents,
             c.language,
             lag(d.day) OVER w AS pday, lag(d.priced_count) OVER w AS pp,
             lag(d.total_cents) OVER w AS pt, lag(d.top20_cents) OVER w AS p20
        FROM catalog_set_daily d JOIN catalog_sets c USING (group_id)
      WINDOW w AS (PARTITION BY d.group_id ORDER BY d.day)
    ), r AS (
      SELECT day, language,
             ln(total_cents::float8 / pt) AS lt,
             CASE WHEN p20 > 0 AND top20_cents > 0
                  THEN ln(top20_cents::float8 / p20) END AS l20
        FROM s
       WHERE pday = day - interval '1 day' AND priced_count = pp
         AND priced_count >= ${MIN_PRICED_CARDS} AND pt > 0 AND total_cents > 0
    )
    SELECT to_char(day, 'YYYY-MM-DD') AS day, language, 'set_total' AS grp,
           count(*) AS n, exp(avg(lt)) - 1 AS change
      FROM r WHERE abs(lt) <= ln(${MAX_DAILY_MOVE}::float8)
     GROUP BY day, language
    UNION ALL
    SELECT to_char(day, 'YYYY-MM-DD'), language, 'set_top20',
           count(*), exp(avg(l20)) - 1
      FROM r WHERE l20 IS NOT NULL AND abs(l20) <= ln(${MAX_DAILY_MOVE}::float8)
     GROUP BY day, language
    ORDER BY 1, 2, 3
  `);

  // Sealed products: classify names here, hand the id → kind map to SQL.
  const names = await db.execute<{ product_id: string; name: string }>(sql`
    SELECT product_id::text AS product_id, name
      FROM catalog_products WHERE kind = 'sealed'
  `);
  const kinds = names
    .map((r) => ({ product_id: r.product_id, type: sealedType(r.name) }))
    .filter(
      (r): r is { product_id: string; type: SealedType } => r.type != null,
    );

  const sealed = await db.execute<ChangeRow>(sql`
    WITH t AS (
      SELECT x.product_id, x.type, c.group_id
        FROM jsonb_to_recordset(${JSON.stringify(kinds)}::jsonb)
             AS x(product_id bigint, type text)
        JOIN catalog_products c ON c.product_id = x.product_id
    ), p AS (
      SELECT x.product_id, s.language, t.type, x.day, x.market_cents,
             lag(x.day) OVER w AS pday, lag(x.market_cents) OVER w AS pm
        FROM catalog_prices x
        JOIN t ON t.product_id = x.product_id
        JOIN catalog_sets s ON s.group_id = t.group_id
      WINDOW w AS (PARTITION BY x.product_id ORDER BY x.day)
    ), r AS (
      SELECT day, language, type, ln(market_cents::float8 / pm) AS l
        FROM p
       WHERE pday = day - interval '1 day' AND market_cents > 0 AND pm > 0
    )
    SELECT to_char(day, 'YYYY-MM-DD') AS day, language, type AS grp,
           count(*) AS n, exp(avg(l)) - 1 AS change
      FROM r WHERE abs(l) <= ln(${MAX_DAILY_MOVE}::float8)
     GROUP BY day, language, type
    ORDER BY 1, 2, 3
  `);

  const bySeries = toChanges([...sets, ...sealed]);
  // "All sealed" blends the four kinds' own typical changes (see blendChanges).
  for (const language of ["en", "ja"] as const) {
    bySeries.set(
      `sealed_all:${language}`,
      blendChanges(
        SEALED_TYPES.map((t) => bySeries.get(`${t}:${language}`) ?? []),
      ),
    );
  }
  const series: IndexSeries[] = [];
  for (const metric of INDEX_METRIC_VALUES) {
    for (const language of ["en", "ja"] as const) {
      const changes = bySeries.get(`${metric}:${language}`) ?? [];
      const points = chainIndex(changes);
      if (points.length > 1) {
        series.push({ metric, language, points, typicalN: typical(changes) });
      }
    }
  }

  const asOfRow = await db.execute<{ day: string | null }>(sql`
    SELECT to_char(max(day), 'YYYY-MM-DD') AS day FROM catalog_set_daily
  `);
  return { asOf: asOfRow[0]?.day ?? null, series };
}

/** Price lookups use the latest price this many days back from the target. */
const AGE_TOLERANCE_DAYS = 3;

type AgeRow = {
  product_id: string;
  group_id: string;
  language: string;
  type: string;
  prices: Array<number | null>;
};

async function computeAgedProducts(): Promise<AgedProduct[]> {
  const names = await db.execute<{ product_id: string; name: string }>(sql`
    SELECT product_id::text AS product_id, name
      FROM catalog_products WHERE kind = 'sealed'
  `);
  const kinds = names
    .map((r) => ({ product_id: r.product_id, type: sealedType(r.name) }))
    .filter(
      (r): r is { product_id: string; type: SealedType } => r.type != null,
    );

  // Only sets released while the history was being collected: for older ones
  // we never saw the launch. For each such set's tracked products, the market
  // price on each age's day (or the last one just before it), and only for
  // ages the set has actually reached.
  const rows = await db.execute<AgeRow>(sql`
    WITH bounds AS (
      SELECT min(day)::date AS first_day, max(day)::date AS last_day
        FROM catalog_set_daily
    ), rel AS (
      SELECT s.group_id, s.language, s.published_on::date AS rel
        FROM catalog_sets s, bounds b
       WHERE s.published_on::date >= b.first_day
         AND s.published_on::date <= b.last_day
    ), t AS (
      SELECT x.product_id, x.type, r.group_id, r.language, r.rel
        FROM jsonb_to_recordset(${JSON.stringify(kinds)}::jsonb)
             AS x(product_id bigint, type text)
        JOIN catalog_products c ON c.product_id = x.product_id
        JOIN rel r ON r.group_id = c.group_id
    ), ages AS (
      SELECT a::int AS ord_age, o AS ord
        FROM jsonb_array_elements_text(${JSON.stringify(AGES)}::jsonb)
             WITH ORDINALITY AS e(a, o)
    )
    SELECT t.product_id::text AS product_id, t.group_id::text AS group_id,
           t.language, t.type,
           jsonb_agg(
             CASE WHEN t.rel + a.ord_age <= (SELECT last_day FROM bounds) THEN
               (SELECT p.market_cents FROM catalog_prices p
                 WHERE p.product_id = t.product_id
                   AND p.market_cents > 0
                   AND p.day <= (t.rel + a.ord_age)
                   AND p.day > (t.rel + a.ord_age - ${AGE_TOLERANCE_DAYS + 1}::int)
                 ORDER BY p.day DESC LIMIT 1)
             END
             ORDER BY a.ord
           ) AS prices
      FROM t CROSS JOIN ages a
     GROUP BY t.product_id, t.group_id, t.language, t.type
  `);

  return rows.map((r) => ({
    groupId: Number(r.group_id),
    language: r.language === "ja" ? "ja" : "en",
    type: r.type as SealedType,
    // Missing is null; anything that isn't a real number is treated as missing
    // too (the driver turns a NULL inside a Postgres array into NaN).
    prices: r.prices.map((p) => {
      const n = p == null ? NaN : Number(p);
      return Number.isFinite(n) ? n : null;
    }),
  }));
}

/** Sets with fewer priced cards than this are promos and trainer kits, not sets. */
const MIN_SET_PRICED = 40;

type AgedSetRow = {
  group_id: string;
  language: string;
  rel: string | null;
  priced: Array<number | string | null>;
  top20: Array<number | string | null>;
  top10: Array<number | string | null>;
  total: Array<number | string | null>;
};

const clean = (a: Array<number | string | null>) =>
  a.map((v) => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  });

/**
 * For every set released while the history was being collected: the number of
 * priced cards and the top-20, top-10 and whole-set values at each lookup age
 * (the latest figure up to 3 days before it), only for ages the set has
 * reached. Promo-sized sets are left out.
 */
async function computeAgedSets(): Promise<AgedSet[]> {
  const rows = await db.execute<AgedSetRow>(sql`
    WITH bounds AS (
      SELECT min(day)::date AS first_day, max(day)::date AS last_day
        FROM catalog_set_daily
    ), big AS (
      SELECT group_id FROM catalog_set_daily
       GROUP BY group_id HAVING max(priced_count) >= ${MIN_SET_PRICED}
    ), rel AS (
      SELECT s.group_id, s.language, s.published_on::date AS rel
        FROM catalog_sets s, bounds b
       WHERE s.group_id IN (SELECT group_id FROM big)
         AND s.published_on::date >= b.first_day
         AND s.published_on::date <= b.last_day
    ), ages AS (
      SELECT a::int AS age, o AS ord
        FROM jsonb_array_elements_text(${JSON.stringify(AGES)}::jsonb)
             WITH ORDINALITY AS e(a, o)
    )
    SELECT r.group_id::text AS group_id, r.language,
           to_char(r.rel, 'YYYY-MM-DD') AS rel,
           jsonb_agg(l.pc ORDER BY a.ord) AS priced,
           jsonb_agg(l.t20 ORDER BY a.ord) AS top20,
           jsonb_agg(l.t10 ORDER BY a.ord) AS top10,
           jsonb_agg(l.tot ORDER BY a.ord) AS total
      FROM rel r CROSS JOIN ages a
      LEFT JOIN LATERAL (
        SELECT d.priced_count AS pc, d.top20_cents AS t20,
               d.top10_cents AS t10, d.total_cents AS tot
          FROM catalog_set_daily d
         WHERE d.group_id = r.group_id
           AND r.rel + a.age <= (SELECT last_day FROM bounds)
           AND d.day <= (r.rel + a.age)
           AND d.day > (r.rel + a.age - ${AGE_TOLERANCE_DAYS + 1}::int)
         ORDER BY d.day DESC LIMIT 1
      ) l ON true
     GROUP BY r.group_id, r.language, r.rel
  `);

  // A date many sets share is a bookkeeping stamp, not a release.
  const dates = await db.execute<{ d: string | null }>(sql`
    SELECT to_char(published_on, 'YYYY-MM-DD') AS d FROM catalog_sets
  `);
  const bulk = bulkReleaseDates(dates.map((r) => r.d));

  return rows
    .filter((r) => r.rel && !bulk.has(r.rel))
    .map((r) => ({
      groupId: Number(r.group_id),
      language: r.language === "ja" ? ("ja" as const) : ("en" as const),
      priced: clean(r.priced),
      top20: clean(r.top20),
      top10: clean(r.top10),
      total: clean(r.total),
    }));
}

const HOUR_MS = 60 * 60 * 1000;

/** Every index series, cached for an hour. */
export const getMarketIndexes = cachedAsync(computeMarketIndexes, HOUR_MS);

/** Sealed prices at fixed ages for sets released during the history. */
export const getAgedProducts = cachedAsync(computeAgedProducts, HOUR_MS);

/** Card values at fixed ages for sets released during the history. */
export const getAgedSets = cachedAsync(computeAgedSets, HOUR_MS);
