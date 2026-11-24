import { describe, expect, it } from "vitest";
import {
  bestPrice,
  buildSetDetail,
  classifyProduct,
  extendedValue,
  MAX_CARDS,
  parsePriceRows,
  toCents,
  type SetMeta,
} from "./catalog_set";

const META: SetMeta = {
  groupId: 1,
  name: "Test Set",
  language: "en",
  abbreviation: "TST",
  publishedOn: "2026-01-01",
};

const card = (
  id: number,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  productId: id,
  name,
  extendedData: [
    { name: "Number", value: `${id}/100` },
    { name: "Rarity", value: "Rare" },
  ],
  ...extra,
});
const sealedP = (id: number, name: string) => ({
  productId: id,
  name,
  extendedData: [],
  imageUrl: `https://img/${id}.jpg`,
  url: `https://tcg/${id}`,
});
const price = (
  id: number,
  market: number | null,
  variant = "Normal",
  low?: number,
) => ({
  productId: id,
  subTypeName: variant,
  marketPrice: market,
  lowPrice: low ?? null,
  midPrice: null,
  highPrice: null,
});

const build = (products: unknown[], prices: unknown[], extra = {}) =>
  buildSetDetail({
    set: META,
    products,
    prices,
    source: "live",
    asOf: "2026-11-22T20:00:00Z",
    ...extra,
  });

describe("toCents", () => {
  it("rounds dollars to whole cents without float noise", () => {
    expect(toCents(133.52)).toBe(13352);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(0)).toBe(0);
  });
  it("rejects missing, negative and junk", () => {
    for (const bad of [null, undefined, -1, "5", NaN, Infinity, {}, []])
      expect(toCents(bad)).toBeNull();
  });
});

describe("parsePriceRows / bestPrice", () => {
  it("groups printings by product and ignores malformed rows", () => {
    const m = parsePriceRows([
      price(1, 1.5),
      price(1, 9.99, "Holofoil"),
      { productId: "x", marketPrice: 3 },
      null,
      { marketPrice: 3 },
    ]);
    expect([...m.keys()]).toEqual([1]);
    expect(m.get(1)).toHaveLength(2);
  });

  it("returns an empty map for a non-array payload", () => {
    expect(parsePriceRows(undefined).size).toBe(0);
    expect(parsePriceRows({}).size).toBe(0);
  });

  it("takes the highest market across printings", () => {
    const rows = parsePriceRows([
      price(1, 1.5),
      price(1, 9.99, "Holofoil"),
      price(1, 3, "Reverse"),
    ]).get(1)!;
    const best = bestPrice(rows)!;
    expect(best.market).toBe(999);
    expect(best.variant).toBe("Holofoil");
  });

  it("ignores unpriced printings, and is null when none is priced", () => {
    const rows = parsePriceRows([price(1, null), price(1, 2, "Holofoil")]).get(
      1,
    )!;
    expect(bestPrice(rows)?.market).toBe(200);
    expect(bestPrice(parsePriceRows([price(1, null)]).get(1)!)).toBeNull();
    expect(bestPrice([])).toBeNull();
  });
});

describe("classifyProduct / extendedValue", () => {
  it("a card has a number or a rarity; everything else is sealed", () => {
    expect(classifyProduct(card(1, "x"))).toBe("card");
    expect(
      classifyProduct({ extendedData: [{ name: "Rarity", value: "Common" }] }),
    ).toBe("card");
    expect(classifyProduct({ extendedData: [] })).toBe("sealed");
    expect(classifyProduct({})).toBe("sealed");
    expect(classifyProduct({ extendedData: null })).toBe("sealed");
  });
  it("reads a named field, treating blanks as missing", () => {
    expect(extendedValue(card(1, "x"), "Rarity")).toBe("Rare");
    expect(
      extendedValue(
        { extendedData: [{ name: "Number", value: "" }] },
        "Number",
      ),
    ).toBeNull();
    expect(extendedValue({}, "Number")).toBeNull();
  });
});

describe("buildSetDetail", () => {
  it("totals the set and lists cards most valuable first", () => {
    const products = [
      card(1, "A"),
      card(2, "B"),
      card(3, "C"),
      sealedP(10, "Elite Trainer Box"),
    ];
    const prices = [price(1, 5), price(2, 50), price(3, 20), price(10, 120)];
    const d = build(products, prices);
    expect(d.cards.map((c) => c.name)).toEqual(["B", "C", "A"]);
    expect(d.totals).toEqual({
      cardCount: 3,
      pricedCount: 3,
      totalCents: 7500,
      top10Cents: 7500,
      top20Cents: 7500,
    });
  });

  it("top-10 and top-20 are the sums of the best 10 and 20 cards", () => {
    const products = Array.from({ length: 30 }, (_, i) =>
      card(i + 1, `C${i + 1}`),
    );
    const prices = Array.from({ length: 30 }, (_, i) => price(i + 1, i + 1));
    const d = build(products, prices);
    // card i is worth i dollars: top 10 = 21..30, top 20 = 11..30
    expect(d.totals.top10Cents).toBe(100 * (21 + 30) * 5);
    expect(d.totals.top20Cents).toBe(100 * (11 + 30) * 10);
    expect(d.totals.totalCents).toBe(100 * 465);
  });

  it("counts unpriced cards but adds nothing for them", () => {
    const d = build([card(1, "A"), card(2, "B")], [price(1, 4)]);
    expect(d.totals.cardCount).toBe(2);
    expect(d.totals.pricedCount).toBe(1);
    expect(d.cards).toHaveLength(1);
  });

  it("values a card at its best printing, not the sum of printings", () => {
    const d = build(
      [card(1, "A"), card(2, "B")],
      [price(1, 1), price(1, 9, "Holofoil"), price(2, 4)],
    );
    expect(d.totals.totalCents).toBe(1300);
    expect(d.cards[0].variant).toBe("Holofoil");
  });

  it("keeps sealed products apart from cards, priciest first, unpriced last", () => {
    const d = build(
      [
        sealedP(10, "Booster Box"),
        sealedP(11, "Booster Pack"),
        sealedP(12, "Case"),
        card(1, "A"),
      ],
      [price(10, 150, "Normal", 140), price(11, 5), price(1, 2)],
    );
    expect(d.sealed.map((s) => s.name)).toEqual([
      "Booster Box",
      "Booster Pack",
      "Case",
    ]);
    expect(d.sealed[0]).toMatchObject({
      marketCents: 15000,
      lowCents: 14000,
      imageUrl: "https://img/10.jpg",
    });
    expect(d.sealed[2].marketCents).toBeNull();
    expect(d.totals.cardCount).toBe(1);
  });

  it("breaks ties by product id so the order never changes between requests", () => {
    const d = build(
      [card(7, "G"), card(3, "C"), card(5, "E")],
      [price(7, 1), price(3, 1), price(5, 1)],
    );
    expect(d.cards.map((c) => c.productId)).toEqual([3, 5, 7]);
  });

  it("cuts a very long card list but totals still cover every card", () => {
    const n = MAX_CARDS + 50;
    const products = Array.from({ length: n }, (_, i) => card(i + 1, `C${i}`));
    const prices = Array.from({ length: n }, (_, i) => price(i + 1, 1));
    const d = build(products, prices);
    expect(d.cards).toHaveLength(MAX_CARDS);
    expect(d.cardsTruncated).toBe(true);
    expect(d.totals.pricedCount).toBe(n);
    expect(d.totals.totalCents).toBe(n * 100);
  });

  it("carries card details through and skips malformed products", () => {
    const d = build(
      [
        card(1, "Pikachu", {
          imageUrl: "https://img/1.jpg",
          url: "https://tcg/1",
        }),
        { productId: "bad", name: "x" },
        { productId: 9 },
        null,
      ],
      [price(1, 2.5)],
    );
    expect(d.cards).toEqual([
      {
        productId: 1,
        name: "Pikachu",
        number: "1/100",
        rarity: "Rare",
        marketCents: 250,
        variant: "Normal",
        imageUrl: "https://img/1.jpg",
        url: "https://tcg/1",
      },
    ]);
    expect(d.totals.cardCount).toBe(1);
  });

  it("handles an empty set and non-array payloads", () => {
    const d = build([], []);
    expect(d.totals).toEqual({
      cardCount: 0,
      pricedCount: 0,
      totalCents: 0,
      top10Cents: 0,
      top20Cents: 0,
    });
    expect(d.cards).toEqual([]);
    expect(build(undefined as never, undefined as never).sealed).toEqual([]);
  });

  it("passes the source, time and note through", () => {
    const d = build([], [], {
      source: "stored",
      asOf: "2026-11-22",
      note: "Last sync",
    });
    expect(d).toMatchObject({
      source: "stored",
      asOf: "2026-11-22",
      note: "Last sync",
    });
  });
});
