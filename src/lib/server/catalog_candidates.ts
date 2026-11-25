/**
 * Every sealed catalogue product with its newest market price. A plain read, kept
 * apart from the link screen's loader so `createItem` can use it without a cycle.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { CatalogCandidate } from "@/lib/calc/catalog_match";

type CandidateRow = {
  product_id: string | number;
  name: string;
  set_name: string;
  language: string;
  image_url: string | null;
  market_cents: string | number | null;
};

/** Every sealed product with its newest market price. */
export async function loadSealedCandidates(): Promise<CatalogCandidate[]> {
  const rows = await db.execute<CandidateRow>(sql`
    SELECT p.product_id, p.name, s.name AS set_name, s.language, p.image_url,
           (SELECT cp.market_cents FROM catalog_prices cp
             WHERE cp.product_id = p.product_id
             ORDER BY cp.day DESC LIMIT 1) AS market_cents
      FROM catalog_products p
      JOIN catalog_sets s ON s.group_id = p.group_id
     WHERE p.kind = 'sealed'
  `);
  return Array.from(rows).map((r) => ({
    productId: Number(r.product_id),
    name: r.name,
    setName: r.set_name,
    language: r.language === "ja" ? "ja" : "en",
    imageUrl: r.image_url,
    marketCents: r.market_cents == null ? null : Number(r.market_cents),
  }));
}

