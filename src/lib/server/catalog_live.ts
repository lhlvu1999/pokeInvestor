/**
 * Live detail for one set: fetched from TCGCSV at the moment someone asks,
 * for that one set only (two small requests), never as a crawl.
 *
 * Being polite to a one-person hobby site is built in:
 * - only sets the catalogue already knows can be requested, so nobody can use
 *   this to make us fetch arbitrary URLs;
 * - a set is fetched at most once an hour (TCGCSV only changes daily);
 * - simultaneous requests for the same set share one fetch;
 * - at most a few sets are being fetched at once, and an upstream failure is
 *   remembered for a minute instead of being retried on every page view.
 *
 * Whenever live data can't be had, the last stored snapshot is served and
 * labelled as such, so the page never just breaks.
 *
 * Not a "use server" file: this is a read, not a client-callable action.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { utcDay } from "@/lib/calc/pg_day";
import { BULK_DATE_THRESHOLD } from "@/lib/calc/set_list";
import {
  buildSetDetail,
  type SetDetail,
  type SetMeta,
} from "@/lib/calc/catalog_set";

const BASE_URL = "https://tcgcsv.com";
const USER_AGENT =
  "poke-investor-app/0.1 (personal tool; fetches one set when a person opens it)";

export const CACHE_TTL_MS = 60 * 60 * 1000;
export const FAILURE_BACKOFF_MS = 60 * 1000;
export const MAX_IN_FLIGHT = 4;

export type SetMetaWithCategory = SetMeta & { categoryId: number };

export type SetLoaderDeps = {
  /** Fetch and parse JSON; throw on any failure. */
  fetchJson: (url: string) => Promise<unknown>;
  loadMeta: (groupId: number) => Promise<SetMetaWithCategory | null>;
  loadStored: (groupId: number) => Promise<SetDetail | null>;
  now: () => number;
};

export class UpstreamUnavailableError extends Error {
  constructor() {
    super(
      "TCGCSV is unavailable and there is no stored snapshot for this set.",
    );
    this.name = "UpstreamUnavailableError";
  }
}

type Cached = { at: number; detail: SetDetail };

/**
 * Build a loader around injectable I/O, so the caching and fallback rules can
 * be tested without a network or a database.
 */
export function createSetLoader(deps: SetLoaderDeps) {
  const cache = new Map<number, Cached>();
  const inFlight = new Map<number, Promise<SetDetail>>();
  const failedAt = new Map<number, number>();

  async function fallback(groupId: number, note: string): Promise<SetDetail> {
    const stored = await deps.loadStored(groupId);
    if (!stored) throw new UpstreamUnavailableError();
    return { ...stored, note };
  }

  async function fetchLive(meta: SetMetaWithCategory): Promise<SetDetail> {
    const base = `${BASE_URL}/tcgplayer/${meta.categoryId}/${meta.groupId}`;
    const [products, prices] = await Promise.all([
      deps.fetchJson(`${base}/products`),
      deps.fetchJson(`${base}/prices`),
    ]);
    const field = (p: unknown) =>
      p && typeof p === "object" ? (p as { results?: unknown }).results : null;
    const { categoryId: _categoryId, ...set } = meta;
    void _categoryId;
    return buildSetDetail({
      set,
      products: field(products),
      prices: field(prices),
      source: "live",
      asOf: new Date(deps.now()).toISOString(),
      note: null,
    });
  }

  return {
    /** The set's detail, or null if the catalogue doesn't know the set. */
    async get(groupId: number): Promise<SetDetail | null> {
      const meta = await deps.loadMeta(groupId);
      if (!meta) return null;

      const now = deps.now();
      const hit = cache.get(groupId);
      if (hit && now - hit.at < CACHE_TTL_MS) return hit.detail;

      const pending = inFlight.get(groupId);
      if (pending) return pending;

      const failed = failedAt.get(groupId);
      if (failed != null && now - failed < FAILURE_BACKOFF_MS) {
        return fallback(
          groupId,
          "TCGCSV couldn't be reached a moment ago, so this is the last daily sync.",
        );
      }
      if (inFlight.size >= MAX_IN_FLIGHT) {
        return fallback(
          groupId,
          "Several sets are being loaded right now, so this is the last daily sync. Try again in a moment.",
        );
      }

      const run = (async () => {
        try {
          const detail = await fetchLive(meta);
          cache.set(groupId, { at: deps.now(), detail });
          failedAt.delete(groupId);
          return detail;
        } catch {
          failedAt.set(groupId, deps.now());
          return fallback(
            groupId,
            "TCGCSV couldn't be reached, so this is the last daily sync.",
          );
        } finally {
          inFlight.delete(groupId);
        }
      })();
      inFlight.set(groupId, run);
      return run;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Real I/O                                                            */
/* ------------------------------------------------------------------ */

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type MetaRow = {
  group_id: string | number;
  category_id: string | number;
  name: string;
  language: string;
  abbreviation: string | null;
  published_on: unknown;
  same_date: string | number;
};

async function loadMeta(groupId: number): Promise<SetMetaWithCategory | null> {
  const rows = await db.execute<MetaRow>(sql`
    SELECT group_id, category_id, name, language, abbreviation, published_on,
           (SELECT count(*) FROM catalog_sets x
             WHERE x.published_on = s.published_on) AS same_date
      FROM catalog_sets s WHERE group_id = ${groupId}
  `);
  const r = Array.from(rows)[0];
  if (!r) return null;
  // A date shared by dozens of sets is a bulk stamp, not a release day.
  const published =
    Number(r.same_date) >= BULK_DATE_THRESHOLD ? null : utcDay(r.published_on);
  return {
    groupId: Number(r.group_id),
    categoryId: Number(r.category_id),
    name: r.name,
    language: r.language === "ja" ? "ja" : "en",
    abbreviation: r.abbreviation,
    publishedOn: published ? published.toISOString().slice(0, 10) : null,
  };
}

type StoredRow = {
  product_id: string | number;
  name: string;
  rarity: string | null;
  card_number: string | null;
  image_url: string | null;
  url: string | null;
  market_cents: string | number;
  variant: string | null;
};

/** The last synced snapshot: daily totals, top-20 cards, sealed prices. */
export async function loadStored(groupId: number): Promise<SetDetail | null> {
  const meta = await loadMeta(groupId);
  if (!meta) return null;
  const [dailyRows, topRows, sealedRows] = await Promise.all([
    db.execute<{
      day: unknown;
      card_count: number;
      priced_count: number;
      total_cents: string | number;
      top10_cents: string | number;
      top20_cents: string | number;
    }>(sql`
      SELECT day, card_count, priced_count, total_cents, top10_cents, top20_cents
        FROM catalog_set_daily WHERE group_id = ${groupId}
       ORDER BY day DESC LIMIT 1
    `),
    db.execute<StoredRow>(sql`
      SELECT t.product_id, p.name, p.rarity, p.card_number, p.image_url, p.url,
             t.market_cents, t.variant
        FROM catalog_set_top t
        JOIN catalog_products p ON p.product_id = t.product_id
       WHERE t.group_id = ${groupId}
         AND t.day = (SELECT max(day) FROM catalog_set_top WHERE group_id = ${groupId})
       ORDER BY t.rank
    `),
    db.execute<{
      product_id: string | number;
      name: string;
      image_url: string | null;
      url: string | null;
      market_cents: string | number | null;
      low_cents: string | number | null;
    }>(sql`
      SELECT p.product_id, p.name, p.image_url, p.url,
             lp.market_cents, lp.low_cents
        FROM catalog_products p
        LEFT JOIN LATERAL (
          SELECT market_cents, low_cents FROM catalog_prices
           WHERE product_id = p.product_id ORDER BY day DESC LIMIT 1
        ) lp ON true
       WHERE p.group_id = ${groupId} AND p.kind = 'sealed'
       ORDER BY lp.market_cents DESC NULLS LAST, p.product_id
    `),
  ]);
  const daily = Array.from(dailyRows)[0];
  if (!daily) return null;
  const day = utcDay(daily.day);
  const num = (v: string | number | null) => (v == null ? null : Number(v));
  return {
    set: {
      groupId: meta.groupId,
      name: meta.name,
      language: meta.language,
      abbreviation: meta.abbreviation,
      publishedOn: meta.publishedOn,
    },
    source: "stored",
    asOf: day ? day.toISOString().slice(0, 10) : "",
    totals: {
      cardCount: daily.card_count,
      pricedCount: daily.priced_count,
      totalCents: Number(daily.total_cents),
      top10Cents: Number(daily.top10_cents),
      top20Cents: Number(daily.top20_cents),
    },
    cards: Array.from(topRows).map((r) => ({
      productId: Number(r.product_id),
      name: r.name,
      number: r.card_number,
      rarity: r.rarity,
      marketCents: Number(r.market_cents),
      variant: r.variant,
      imageUrl: r.image_url,
      url: r.url,
    })),
    cardsTruncated: daily.priced_count > topRows.length,
    sealed: Array.from(sealedRows).map((r) => ({
      productId: Number(r.product_id),
      name: r.name,
      marketCents: num(r.market_cents),
      lowCents: num(r.low_cents),
      imageUrl: r.image_url,
      url: r.url,
    })),
    note: null,
  };
}

const loader = createSetLoader({
  fetchJson,
  loadMeta,
  loadStored,
  now: () => Date.now(),
});

/** Detail for one set, live when possible. Null if the set is unknown. */
export function getSetDetail(groupId: number): Promise<SetDetail | null> {
  return loader.get(groupId);
}
