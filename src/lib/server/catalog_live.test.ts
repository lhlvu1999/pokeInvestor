import { describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_MS,
  createSetLoader,
  FAILURE_BACKOFF_MS,
  MAX_IN_FLIGHT,
  UpstreamUnavailableError,
  type SetLoaderDeps,
  type SetMetaWithCategory,
} from "./catalog_live";
import type { SetDetail } from "@/lib/calc/catalog_set";

// catalog_live imports the database client; the loader under test never
// touches it, so stub it out for these pure tests.
vi.mock("@/db/client", () => ({ db: {} }));

const META = (groupId: number): SetMetaWithCategory => ({
  groupId,
  categoryId: 3,
  name: `Set ${groupId}`,
  language: "en",
  abbreviation: null,
  publishedOn: "2026-01-01",
});

const STORED = (groupId: number): SetDetail => ({
  set: { ...META(groupId), categoryId: undefined } as never,
  source: "stored",
  asOf: "2026-11-21",
  totals: {
    cardCount: 1,
    pricedCount: 1,
    totalCents: 100,
    top10Cents: 100,
    top20Cents: 100,
  },
  cards: [],
  cardsTruncated: false,
  sealed: [],
  note: null,
});

const PRODUCTS = {
  results: [
    {
      productId: 1,
      name: "Pikachu",
      extendedData: [{ name: "Number", value: "1/10" }],
    },
  ],
};
const PRICES = {
  results: [{ productId: 1, subTypeName: "Normal", marketPrice: 12.5 }],
};

function deps(over: Partial<SetLoaderDeps> = {}) {
  let t = 1_000_000;
  const clock = { advance: (ms: number) => (t += ms) };
  const fetchJson = vi.fn(async (url: string) =>
    url.endsWith("/products") ? PRODUCTS : PRICES,
  );
  const d: SetLoaderDeps = {
    fetchJson,
    loadMeta: async (g) => (g === 999 ? null : META(g)),
    loadStored: async (g) => STORED(g),
    now: () => t,
    ...over,
  };
  return { d, fetchJson, clock };
}

describe("createSetLoader", () => {
  it("fetches the set live from the right TCGCSV URLs and builds the detail", async () => {
    const { d, fetchJson } = deps();
    const detail = await createSetLoader(d).get(42);
    expect(fetchJson.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://tcgcsv.com/tcgplayer/3/42/prices",
      "https://tcgcsv.com/tcgplayer/3/42/products",
    ]);
    expect(detail?.source).toBe("live");
    expect(detail?.cards[0]).toMatchObject({
      name: "Pikachu",
      marketCents: 1250,
    });
    expect(detail?.totals.totalCents).toBe(1250);
    expect(detail?.set.groupId).toBe(42);
    // The category id is an internal detail and must not leak into the answer.
    expect(detail?.set).not.toHaveProperty("categoryId");
  });

  it("returns null for a set the catalogue doesn't know, without fetching", async () => {
    const { d, fetchJson } = deps();
    expect(await createSetLoader(d).get(999)).toBeNull();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("serves a repeat request from the cache for an hour, then refetches", async () => {
    const { d, fetchJson, clock } = deps();
    const loader = createSetLoader(d);
    await loader.get(1);
    await loader.get(1);
    expect(fetchJson).toHaveBeenCalledTimes(2); // products + prices, once
    clock.advance(CACHE_TTL_MS - 1);
    await loader.get(1);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    clock.advance(2);
    await loader.get(1);
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it("caches each set separately", async () => {
    const { d, fetchJson } = deps();
    const loader = createSetLoader(d);
    await loader.get(1);
    await loader.get(2);
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it("shares one fetch between simultaneous requests for the same set", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { d, fetchJson } = deps({
      fetchJson: vi.fn(async (url: string) => {
        await gate;
        return url.endsWith("/products") ? PRODUCTS : PRICES;
      }),
    });
    const loader = createSetLoader(d);
    const a = loader.get(1);
    const b = loader.get(1);
    await Promise.resolve();
    release();
    const [x, y] = await Promise.all([a, b]);
    expect(x).toBe(y);
    expect(d.fetchJson).toHaveBeenCalledTimes(2);
    void fetchJson;
  });

  it("falls back to the stored snapshot, labelled, when TCGCSV fails", async () => {
    const { d } = deps({
      fetchJson: vi.fn(async () => Promise.reject(new Error("down"))),
    });
    const detail = await createSetLoader(d).get(1);
    expect(detail?.source).toBe("stored");
    expect(detail?.note).toMatch(/couldn't be reached/);
  });

  it("doesn't retry a failing set on every view: it backs off for a minute", async () => {
    const fail = vi.fn(async () => Promise.reject(new Error("down")));
    const { d, clock } = deps({ fetchJson: fail });
    const loader = createSetLoader(d);
    await loader.get(1);
    const first = fail.mock.calls.length;
    await loader.get(1);
    await loader.get(1);
    expect(fail.mock.calls.length).toBe(first);
    clock.advance(FAILURE_BACKOFF_MS + 1);
    await loader.get(1);
    expect(fail.mock.calls.length).toBeGreaterThan(first);
  });

  it("recovers after a failure once the upstream works again", async () => {
    let up = false;
    const { d, clock } = deps({
      fetchJson: vi.fn(async (url: string) => {
        if (!up) throw new Error("down");
        return url.endsWith("/products") ? PRODUCTS : PRICES;
      }),
    });
    const loader = createSetLoader(d);
    expect((await loader.get(1))?.source).toBe("stored");
    up = true;
    clock.advance(FAILURE_BACKOFF_MS + 1);
    expect((await loader.get(1))?.source).toBe("live");
  });

  it("throws, rather than inventing data, when there is neither live nor stored data", async () => {
    const { d } = deps({
      fetchJson: vi.fn(async () => Promise.reject(new Error("down"))),
      loadStored: async () => null,
    });
    await expect(createSetLoader(d).get(1)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it("limits how many different sets are fetched at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = vi.fn(async (url: string) => {
      await gate;
      return url.endsWith("/products") ? PRODUCTS : PRICES;
    });
    const { d } = deps({ fetchJson: slow });
    const loader = createSetLoader(d);
    const busy = Array.from({ length: MAX_IN_FLIGHT }, (_, i) =>
      loader.get(100 + i),
    );
    await new Promise((r) => setTimeout(r, 0));
    const extra = await loader.get(200);
    expect(extra?.source).toBe("stored");
    expect(extra?.note).toMatch(/being loaded right now/);
    // The extra one must not have started an upstream fetch of its own.
    expect(slow).toHaveBeenCalledTimes(MAX_IN_FLIGHT * 2);
    release();
    await Promise.all(busy);
  });

  it("treats a malformed upstream body as an empty set rather than crashing", async () => {
    const { d } = deps({ fetchJson: vi.fn(async () => ({ nonsense: true })) });
    const detail = await createSetLoader(d).get(1);
    expect(detail?.source).toBe("live");
    expect(detail?.cards).toEqual([]);
    expect(detail?.totals.totalCents).toBe(0);
  });
});
