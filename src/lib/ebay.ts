/**
 * eBay Browse API client.
 *   Docs:  https://developer.ebay.com/api-docs/buy/browse/overview.html
 *   Auth:  OAuth2 client_credentials -> "application access token" (2h)
 *   Money: decimal strings + ISO currency; we convert to minor units.
 *
 * ── What this can and cannot do ───────────────────────────────────────
 * Browse returns **active listings** — i.e. what sellers are ASKING, not
 * what items actually SOLD for. Sold data lives behind the Marketplace
 * Insights API, which requires a separate eBay application that is rarely
 * granted (our production keyset gets HTTP 403 on it).
 *
 * Asking prices skew above clearing price: sellers list optimistically and
 * many listings never sell. `estimateMarketPrice` compensates by taking a
 * low percentile of the genuine-product cluster rather than a mean or
 * median. Treat the output as "approximate resale value", not a quote.
 */

import {
  buildSearchQuery,
  estimateMarketPrice,
  type PriceEstimate,
  type PriceEstimateInput,
} from "./calc/price_estimate";

const OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

/** "Collectible Card Games". Broad enough to include every Pokémon TCG
 * product type, narrow enough to exclude video games / plush / apparel
 * that mention the set name. */
const DEFAULT_CATEGORY_ID = "2536";

/** Listings pulled per estimate. eBay caps `limit` at 200; 50 gives a
 * good sample without burning rate limit on a bulk refresh. */
const SEARCH_LIMIT = 50;

export class EbayError extends Error {
  constructor(
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "EbayError";
  }
}

export type EbayListing = {
  itemId: string;
  title: string;
  /** Item price only, in minor units of `currency`. */
  priceMinor: number;
  /** Shipping, in the same minor units. 0 when free or unknown. */
  shippingMinor: number;
  /** priceMinor + shippingMinor — what the buyer actually pays. */
  totalMinor: number;
  currency: string;
  condition: string | null;
  itemWebUrl: string | null;
};

export type EbayPriceResult = {
  estimate: PriceEstimate;
  currency: string;
  /** The exact `q` sent to eBay — surfaced in the UI so a bad match is
   * diagnosable and the user can override it per item. */
  query: string;
  /** Total listings eBay reported matching (not just the sampled page). */
  totalMatching: number;
  /** A few of the cheapest kept listings, for the preview table. */
  samples: EbayListing[];
};

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

/**
 * Mint (or reuse) an application access token. Cached in module scope and
 * refreshed at 90% of its lifetime so a long bulk refresh doesn't expire
 * mid-run.
 */
export async function getAppToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.token;

  const clientId = process.env.EBAY_APP_ID;
  const clientSecret = process.env.EBAY_CERT_ID;
  if (!clientId || !clientSecret) {
    throw new EbayError(
      "eBay credentials missing. Set EBAY_APP_ID and EBAY_CERT_ID in .env.",
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: SCOPE,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EbayError(
      `eBay OAuth failed (HTTP ${res.status}). ${body.slice(0, 200)}`,
      res.status,
    );
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new EbayError("eBay OAuth returned no access_token");
  }

  const ttlMs = (json.expires_in ?? 7200) * 1000;
  cached = { token: json.access_token, expiresAt: now + ttlMs * 0.9 };
  return cached.token;
}

/** Test seam — clears the token cache. */
export function _resetTokenCache(): void {
  cached = null;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** Convert eBay's decimal string ("145.99") to minor units for the given
 * currency. eBay always reports 2dp for the currencies we query. */
function toMinor(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

type RawSummary = {
  itemId?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  shippingOptions?: Array<{
    shippingCost?: { value?: string; currency?: string };
  }>;
  condition?: string;
  itemWebUrl?: string;
};

export async function searchListings(
  query: string,
  opts: {
    marketplaceId?: string;
    categoryId?: string;
    limit?: number;
    /** Restrict to condition NEW. Correct for sealed product (the common
     * case) and measurably reduces accessory/opened-item noise. Set false
     * for graded slabs and anything second-hand, where NEW is wrong. */
    newOnly?: boolean;
  } = {},
): Promise<{ listings: EbayListing[]; totalMatching: number }> {
  const token = await getAppToken();
  const marketplaceId =
    opts.marketplaceId ?? process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";

  // Fixed-price only: an auction's "current bid" is mid-auction noise,
  // not a price signal.
  const filters = ["buyingOptions:{FIXED_PRICE}"];
  if (opts.newOnly !== false) filters.push("conditions:{NEW}");

  const params = new URLSearchParams({
    q: query,
    filter: filters.join(","),
    category_ids: opts.categoryId ?? DEFAULT_CATEGORY_ID,
    limit: String(opts.limit ?? SEARCH_LIMIT),
    sort: "price",
  });

  const res = await fetch(`${BROWSE_URL}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EbayError(
      `eBay Browse failed (HTTP ${res.status}). ${body.slice(0, 200)}`,
      res.status,
    );
  }

  const json = (await res.json()) as {
    total?: number;
    itemSummaries?: RawSummary[];
  };

  const listings: EbayListing[] = [];
  for (const s of json.itemSummaries ?? []) {
    const priceMinor = toMinor(s.price?.value);
    if (priceMinor <= 0) continue;
    const shippingMinor = toMinor(s.shippingOptions?.[0]?.shippingCost?.value);
    listings.push({
      itemId: s.itemId ?? "",
      title: s.title ?? "(untitled)",
      priceMinor,
      shippingMinor,
      totalMinor: priceMinor + shippingMinor,
      currency: s.price?.currency ?? "USD",
      condition: s.condition ?? null,
      itemWebUrl: s.itemWebUrl ?? null,
    });
  }

  return { listings, totalMatching: json.total ?? listings.length };
}

/* ------------------------------------------------------------------ */
/* Estimate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Search eBay for `productName` and derive a market-price estimate.
 *
 * `queryOverride` replaces the generated query wholesale — the escape
 * hatch for products whose name doesn't search well. It is used verbatim,
 * so the caller is responsible for its own negative keywords.
 *
 * Returns null when there were too few usable listings to justify any
 * number (see MIN_SAMPLE in price_estimate.ts).
 */
export async function fetchEbayEstimate(
  productName: string,
  opts: {
    queryOverride?: string | null;
    marketplaceId?: string;
    newOnly?: boolean;
  } = {},
): Promise<EbayPriceResult | null> {
  const query = opts.queryOverride?.trim()
    ? opts.queryOverride.trim()
    : buildSearchQuery(productName);

  const { listings, totalMatching } = await searchListings(query, {
    marketplaceId: opts.marketplaceId,
    newOnly: opts.newOnly,
  });

  // Only price a homogeneous currency set. Mixed-currency results would
  // make the percentile meaningless; in practice a single marketplace
  // returns one currency.
  const currency = listings[0]?.currency ?? "USD";
  const sameCurrency = listings.filter((l) => l.currency === currency);

  const input: PriceEstimateInput[] = sameCurrency.map((l) => ({
    totalMinor: l.totalMinor,
    title: l.title,
  }));
  const estimate = estimateMarketPrice(input);
  if (!estimate) return null;

  // Preview samples: the cheapest kept listings, which is where a
  // mismatched query is most visible to a human.
  const samples = sameCurrency
    .filter(
      (l) =>
        l.totalMinor >= estimate.keptMinMinor &&
        l.totalMinor <= estimate.keptMaxMinor,
    )
    .sort((a, b) => a.totalMinor - b.totalMinor)
    .slice(0, 5);

  return { estimate, currency, query, totalMatching, samples };
}
