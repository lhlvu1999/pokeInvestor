/**
 * How far individual sealed products' prices have actually moved over 30 and
 * 90 days, by kind and language: the spread, not the average. The market
 * index is smooth because products falling after launch are offset by older
 * ones rising; a stock concentrated in a few products feels the spread.
 *
 * Every window of that many days since the data began counts (a product
 * contributes one per day it has a price at both ends). A move beyond 10x
 * either way is treated as a data glitch and left out, the same spirit as the
 * index's guard against a $284 box showing as $1. A pure read (no "use server"),
 * cached for an hour.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cachedAsync } from "@/lib/calc/cached";
import { sealedType, type SealedType } from "@/lib/calc/sealed_type";

export type Moves = {
  /** Price windows behind the figures. */
  windows: number;
  /** Different products behind them. */
  products: number;
  /** Changes as fractions (−0.2 = −20%). */
  p05: number;
  p10: number;
  p50: number;
};

/** Keyed "kind:language", or "sealed_all:language" for all tracked kinds. */
export type MovesTable = Map<string, Moves>;

export const MOVE_WINDOWS = [30, 90] as const;
/** A change beyond this multiple (up or down) is a data glitch. */
const MAX_MULTIPLE = 10;

type Row = {
  kind: string | null;
  language: string;
  windows: string | number;
  products: string | number;
  p05: number | string;
  p10: number | string;
  p50: number | string;
};

async function compute(): Promise<Record<number, MovesTable>> {
  const names = await db.execute<{ product_id: string; name: string }>(sql`
    SELECT product_id::text AS product_id, name
      FROM catalog_products WHERE kind = 'sealed'
  `);
  const kinds = names
    .map((r) => ({ product_id: r.product_id, type: sealedType(r.name) }))
    .filter(
      (r): r is { product_id: string; type: SealedType } => r.type != null,
    );
  const json = JSON.stringify(kinds);

  const out: Record<number, MovesTable> = {};
  for (const days of MOVE_WINDOWS) {
    const rows = await db.execute<Row>(sql`
      WITH t AS (
        SELECT x.product_id, x.type, s.language
          FROM jsonb_to_recordset(${json}::jsonb) AS x(product_id bigint, type text)
          JOIN catalog_products c ON c.product_id = x.product_id
          JOIN catalog_sets s ON s.group_id = c.group_id
      ), w AS (
        SELECT t.type, t.language, t.product_id,
               p2.market_cents::float8 / p1.market_cents - 1 AS change
          FROM catalog_prices p1
          JOIN t ON t.product_id = p1.product_id
          JOIN catalog_prices p2
            ON p2.product_id = p1.product_id
           AND p2.day = p1.day + make_interval(days => ${days}::int)
         WHERE p1.market_cents > 0 AND p2.market_cents > 0
           AND p2.market_cents::float8 / p1.market_cents
               BETWEEN ${1 / MAX_MULTIPLE}::float8 AND ${MAX_MULTIPLE}::float8
      )
      SELECT type AS kind, language, count(*) AS windows,
             count(DISTINCT product_id) AS products,
             percentile_cont(0.05) WITHIN GROUP (ORDER BY change) AS p05,
             percentile_cont(0.10) WITHIN GROUP (ORDER BY change) AS p10,
             percentile_cont(0.50) WITHIN GROUP (ORDER BY change) AS p50
        FROM w GROUP BY GROUPING SETS ((type, language), (language))
    `);
    const table: MovesTable = new Map();
    for (const r of rows) {
      table.set(`${r.kind ?? "sealed_all"}:${r.language}`, {
        windows: Number(r.windows),
        products: Number(r.products),
        p05: Number(r.p05),
        p10: Number(r.p10),
        p50: Number(r.p50),
      });
    }
    out[days] = table;
  }
  return out;
}

/** The spread of product moves for each window, cached for an hour. */
export const getProductMoves = cachedAsync(compute, 60 * 60 * 1000);
