/**
 * One set's detail, built from TCGCSV's two files for that set: its products
 * and its prices.
 *
 * These are the SAME rules the pipeline's `catalog-sync` uses to compute the
 * stored daily totals (pipeline/src/poke_pipeline/catalog.py), so the live
 * view and the stored history never disagree about what a card is worth or
 * what a set totals:
 *
 * - a product with a card number or a rarity is a card; everything else is a
 *   sealed product;
 * - a card counts at its HIGHEST market price across its printings (normal,
 *   holo, reverse holo, 1st edition...), "one of each card, best version";
 * - cards with no market price are counted but add nothing.
 *
 * Money is whole US cents.
 */

export type SetMeta = {
  groupId: number;
  name: string;
  language: "en" | "ja";
  abbreviation: string | null;
  /** YYYY-MM-DD, if known. */
  publishedOn: string | null;
};

export type PriceRow = {
  productId: number;
  variant: string | null;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
};

export type SetCard = {
  productId: number;
  name: string;
  number: string | null;
  rarity: string | null;
  marketCents: number;
  /** The printing that price is for. */
  variant: string | null;
  imageUrl: string | null;
  url: string | null;
};

export type SetSealed = {
  productId: number;
  name: string;
  marketCents: number | null;
  lowCents: number | null;
  imageUrl: string | null;
  url: string | null;
};

export type SetTotals = {
  /** Cards in the set, priced or not. */
  cardCount: number;
  pricedCount: number;
  totalCents: number;
  top10Cents: number;
  top20Cents: number;
};

export type SetDetail = {
  set: SetMeta;
  /** "live" = read from TCGCSV for this request; "stored" = the last sync. */
  source: "live" | "stored";
  /** When the prices are from (an ISO timestamp, or a day for stored data). */
  asOf: string;
  totals: SetTotals;
  /** Priced cards, most valuable first. May be cut at `MAX_CARDS`. */
  cards: SetCard[];
  /** More priced cards than were returned. */
  cardsTruncated: boolean;
  sealed: SetSealed[];
  /** Plain-language caveat shown with the data, if any. */
  note: string | null;
};

/** Most cards returned for one set; totals always cover all of them. */
export const MAX_CARDS = 500;

export function toCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value * 100);
}

type Raw = Record<string, unknown>;

export function parsePriceRows(results: unknown): Map<number, PriceRow[]> {
  const out = new Map<number, PriceRow[]>();
  if (!Array.isArray(results)) return out;
  for (const r of results as Raw[]) {
    const productId = r?.productId;
    if (typeof productId !== "number" || !Number.isInteger(productId)) continue;
    const row: PriceRow = {
      productId,
      variant: typeof r.subTypeName === "string" ? r.subTypeName : null,
      market: toCents(r.marketPrice),
      low: toCents(r.lowPrice),
      mid: toCents(r.midPrice),
      high: toCents(r.highPrice),
    };
    const list = out.get(productId);
    if (list) list.push(row);
    else out.set(productId, [row]);
  }
  return out;
}

/** The printing that represents the product: highest market price. */
export function bestPrice(rows: ReadonlyArray<PriceRow>): PriceRow | null {
  let best: PriceRow | null = null;
  for (const r of rows) {
    if (r.market == null) continue;
    if (best == null || r.market > (best.market ?? 0)) best = r;
  }
  return best;
}

function extended(raw: Raw): { name: unknown; value: unknown }[] {
  const e = raw.extendedData;
  return Array.isArray(e)
    ? (e.filter((x) => x && typeof x === "object") as {
        name: unknown;
        value: unknown;
      }[])
    : [];
}

export function classifyProduct(raw: Raw): "card" | "sealed" {
  const names = new Set(extended(raw).map((e) => e.name));
  return names.has("Number") || names.has("Rarity") ? "card" : "sealed";
}

export function extendedValue(raw: Raw, name: string): string | null {
  for (const e of extended(raw)) {
    if (e.name === name) {
      return typeof e.value === "string" && e.value !== "" ? e.value : null;
    }
  }
  return null;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

/**
 * Build a set's detail from the raw `products` and `prices` result arrays.
 * Products that aren't well-formed (no id or name) are skipped.
 */
export function buildSetDetail(input: {
  set: SetMeta;
  products: unknown;
  prices: unknown;
  source: "live" | "stored";
  asOf: string;
  note?: string | null;
  maxCards?: number;
}): SetDetail {
  const prices = parsePriceRows(input.prices);
  const cards: SetCard[] = [];
  const sealed: SetSealed[] = [];
  let cardCount = 0;

  for (const p of Array.isArray(input.products)
    ? (input.products as Raw[])
    : []) {
    const productId = p?.productId;
    const name = p?.name;
    if (typeof productId !== "number" || typeof name !== "string") continue;
    const best = bestPrice(prices.get(productId) ?? []);
    if (classifyProduct(p) === "card") {
      cardCount += 1;
      if (best && best.market != null) {
        cards.push({
          productId,
          name,
          number: extendedValue(p, "Number"),
          rarity: extendedValue(p, "Rarity"),
          marketCents: best.market,
          variant: best.variant,
          imageUrl: str(p.imageUrl),
          url: str(p.url),
        });
      }
    } else {
      sealed.push({
        productId,
        name,
        marketCents: best?.market ?? null,
        lowCents: best?.low ?? null,
        imageUrl: str(p.imageUrl),
        url: str(p.url),
      });
    }
  }

  // Ties by product id so the order is the same on every request.
  cards.sort(
    (a, b) => b.marketCents - a.marketCents || a.productId - b.productId,
  );
  sealed.sort(
    (a, b) =>
      (b.marketCents ?? -1) - (a.marketCents ?? -1) ||
      a.productId - b.productId,
  );

  const sum = (list: SetCard[]) => list.reduce((n, c) => n + c.marketCents, 0);
  const cap = input.maxCards ?? MAX_CARDS;
  return {
    set: input.set,
    source: input.source,
    asOf: input.asOf,
    totals: {
      cardCount,
      pricedCount: cards.length,
      totalCents: sum(cards),
      top10Cents: sum(cards.slice(0, 10)),
      top20Cents: sum(cards.slice(0, 20)),
    },
    cards: cards.slice(0, cap),
    cardsTruncated: cards.length > cap,
    sealed,
    note: input.note ?? null,
  };
}
