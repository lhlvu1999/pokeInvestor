/**
 * What the catalogue knows about the product an item is linked to. A pure
 * read (no "use server").
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { utcDay } from "@/lib/calc/pg_day";

export type ItemCatalogInfo = {
  productId: number;
  name: string;
  setName: string;
  language: "en" | "ja";
  url: string | null;
  latest: { day: Date; marketCents: number } | null;
  /** The newest price at least 28 days older than `latest`, if we have one. */
  prior: { day: Date; marketCents: number } | null;
};

type Row = {
  name: string;
  set_name: string;
  language: string;
  url: string | null;
  day: Date | null;
  market_cents: number | string | null;
};

const DAY_MS = 86_400_000;

export async function getItemCatalogInfo(
  productId: number,
): Promise<ItemCatalogInfo | null> {
  const rows = await db.execute<Row>(sql`
    SELECT p.name, s.name AS set_name, s.language, p.url, cp.day, cp.market_cents
      FROM catalog_products p
      JOIN catalog_sets s ON s.group_id = p.group_id
      LEFT JOIN catalog_prices cp ON cp.product_id = p.product_id
     WHERE p.product_id = ${productId}
     ORDER BY cp.day DESC NULLS LAST
  `);
  const list = Array.from(rows);
  if (list.length === 0) return null;
  const head = list[0];
  const points = list.flatMap((r) => {
    const day = utcDay(r.day);
    return day && r.market_cents != null
      ? [{ day, marketCents: Number(r.market_cents) }]
      : [];
  });
  const latest = points[0] ?? null;
  const prior = latest
    ? (points.find(
        (p) => latest.day.getTime() - p.day.getTime() >= 28 * DAY_MS,
      ) ?? null)
    : null;
  return {
    productId,
    name: head.name,
    setName: head.set_name,
    language: head.language === "ja" ? "ja" : "en",
    url: head.url,
    latest,
    prior,
  };
}
