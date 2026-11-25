"use server";

/**
 * Look a product or card up in the catalogue while adding an item, so the new item
 * can be linked to its set right away instead of waiting for the daily sync.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { searchWords } from "@/lib/calc/catalog_search";

export type CatalogHit = {
  productId: number;
  kind: "sealed" | "card";
  name: string;
  setName: string;
  /** TCGplayer's short code for the set, when it has one. */
  setAbbreviation: string | null;
  language: "en" | "ja";
  cardNumber: string | null;
  imageUrl: string | null;
  /** TCGplayer's latest market price in US cents; only sealed products have one. */
  marketUsdCents: number | null;
};

type Row = {
  product_id: string | number;
  kind: string;
  name: string;
  set_name: string;
  abbreviation: string | null;
  language: string;
  card_number: string | null;
  image_url: string | null;
  market_cents: string | number | null;
};

const LIMIT = 8;

export async function searchCatalogue(query: string): Promise<CatalogHit[]> {
  const words = searchWords(typeof query === "string" ? query : "");
  if (words.length === 0) return [];
  const conds = words.map(
    (w) => sql`(p.name ILIKE ${"%" + w + "%"} OR s.name ILIKE ${"%" + w + "%"}
              OR p.card_number ILIKE ${"%" + w + "%"} OR s.abbreviation ILIKE ${"%" + w + "%"})`,
  );
  const rows = await db.execute<Row>(sql`
    SELECT p.product_id, p.kind, p.name, s.name AS set_name, s.abbreviation, s.language,
           p.card_number, p.image_url,
           (SELECT cp.market_cents FROM catalog_prices cp
             WHERE cp.product_id = p.product_id
             ORDER BY cp.day DESC LIMIT 1) AS market_cents
      FROM catalog_products p
      JOIN catalog_sets s ON s.group_id = p.group_id
     WHERE ${sql.join(conds, sql` AND `)}
     ORDER BY (p.kind = 'sealed') DESC, length(p.name), s.published_on DESC NULLS LAST, p.product_id
     LIMIT ${LIMIT}
  `);
  return Array.from(rows).map((r) => ({
    productId: Number(r.product_id),
    kind: r.kind === "sealed" ? "sealed" : "card",
    name: r.name,
    setName: r.set_name,
    setAbbreviation: r.abbreviation,
    language: r.language === "ja" ? "ja" : "en",
    cardNumber: r.card_number,
    imageUrl: r.image_url,
    marketUsdCents: r.market_cents == null ? null : Number(r.market_cents),
  }));
}
