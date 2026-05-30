/**
 * PriceCharting API client.
 *  Docs: https://www.pricecharting.com/api-documentation
 *  Auth: token in query string (?t=...)
 *  Prices: integer cents (USD).
 */

const BASE = "https://www.pricecharting.com/api";

export type PriceChartingProduct = {
  id: number;
  productName: string;
  consoleName: string | null;
  /** Cents (USD). null when unavailable for this product condition. */
  loosePriceCents: number | null;
  /** Cents (USD). For sealed product like ETBs this is typically the field to use. */
  newPriceCents: number | null;
  /** Cents (USD). Complete-in-box. */
  cibPriceCents: number | null;
};

type RawProduct = {
  status: string;
  id: number;
  "product-name"?: string;
  "console-name"?: string;
  "loose-price"?: number;
  "new-price"?: number;
  "cib-price"?: number;
  error?: string;
};

export class PriceChartingError extends Error {
  constructor(message: string, public httpStatus?: number) {
    super(message);
    this.name = "PriceChartingError";
  }
}

export async function fetchProduct(
  productId: string,
  apiToken: string,
): Promise<PriceChartingProduct> {
  if (!apiToken) throw new PriceChartingError("Missing API token");
  const url = `${BASE}/product?t=${encodeURIComponent(
    apiToken,
  )}&id=${encodeURIComponent(productId)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new PriceChartingError(
      `PriceCharting HTTP ${res.status}`,
      res.status,
    );
  }
  const json = (await res.json()) as RawProduct;
  if (json.status !== "success") {
    throw new PriceChartingError(json.error ?? "PriceCharting returned error");
  }

  return {
    id: json.id,
    productName: json["product-name"] ?? "",
    consoleName: json["console-name"] ?? null,
    loosePriceCents: json["loose-price"] ?? null,
    newPriceCents: json["new-price"] ?? null,
    cibPriceCents: json["cib-price"] ?? null,
  };
}

/**
 * Best-effort price extraction. Prefers `new-price` (sealed) → `cib-price` →
 * `loose-price`. Returns null if all are missing.
 */
export function pickBestPriceCents(p: PriceChartingProduct): number | null {
  return p.newPriceCents ?? p.cibPriceCents ?? p.loosePriceCents ?? null;
}
