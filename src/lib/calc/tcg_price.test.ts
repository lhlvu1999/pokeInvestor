import { describe, expect, it } from "vitest";
import {
  MAX_CATALOG_PRICE_AGE_DAYS,
  TCG_REWRITE_AFTER_MS,
  needsTcgWrite,
  usableCatalogUsdCents,
} from "./tcg_price";

const now = new Date("2026-11-25T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const base = { marketCents: 5870, day: daysAgo(2), now, itemCurrency: "VND" };

describe("usableCatalogUsdCents", () => {
  it("uses a recent positive catalogue price", () => {
    expect(usableCatalogUsdCents(base)).toBe(5870);
  });
  it("is null with no price, a zero price or a negative one", () => {
    expect(usableCatalogUsdCents({ ...base, marketCents: null })).toBeNull();
    expect(usableCatalogUsdCents({ ...base, marketCents: 0 })).toBeNull();
    expect(usableCatalogUsdCents({ ...base, marketCents: -5 })).toBeNull();
    expect(usableCatalogUsdCents({ ...base, marketCents: Number.NaN })).toBeNull();
  });
  it("is null when the price is older than the limit, and fine right at it", () => {
    expect(usableCatalogUsdCents({ ...base, day: daysAgo(MAX_CATALOG_PRICE_AGE_DAYS + 0.1) })).toBeNull();
    expect(usableCatalogUsdCents({ ...base, day: daysAgo(MAX_CATALOG_PRICE_AGE_DAYS) })).toBe(5870);
    expect(usableCatalogUsdCents({ ...base, day: null })).toBeNull();
  });
  it("is null for an item with no currency (no transactions yet)", () => {
    expect(usableCatalogUsdCents({ ...base, itemCurrency: null })).toBeNull();
  });
});

describe("needsTcgWrite", () => {
  it("writes when there is no price yet", () => {
    expect(needsTcgWrite(null, now)).toBe(true);
  });
  it("does not write twice in a few hours", () => {
    const recent = { source: "tcgplayer", fetchedAt: new Date(now.getTime() - 3_600_000) };
    expect(needsTcgWrite(recent, now)).toBe(false);
  });
  it("writes again once the last TCGplayer row is old enough", () => {
    const old = { source: "tcgplayer", fetchedAt: new Date(now.getTime() - TCG_REWRITE_AFTER_MS) };
    expect(needsTcgWrite(old, now)).toBe(true);
  });
  it("writes when the newest row is eBay or manual, so TCGplayer wins again", () => {
    const fresh = new Date(now.getTime() - 60_000);
    expect(needsTcgWrite({ source: "ebay", fetchedAt: fresh }, now)).toBe(true);
    expect(needsTcgWrite({ source: "manual", fetchedAt: fresh }, now)).toBe(true);
  });
});
