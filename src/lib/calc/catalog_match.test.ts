import { describe, expect, it } from "vitest";
import {
  isSealedCandidate,
  matchItem,
  prepareCatalog,
  priceSanity,
  tokens,
  type CatalogCandidate,
} from "./catalog_match";

let nextId = 1;
const cand = (
  name: string,
  setName: string,
  extra: Partial<CatalogCandidate> = {},
): CatalogCandidate => ({
  productId: nextId++,
  name,
  setName,
  language: "en",
  imageUrl: null,
  marketCents: null,
  ...extra,
});

const catalog = prepareCatalog([
  cand("Black Bolt Elite Trainer Box", "SV: Black Bolt"),
  cand("Black Bolt Booster Box", "SV: Black Bolt"),
  cand("Black Bolt Booster Bundle", "SV: Black Bolt"),
  cand("Black Bolt Elite Trainer Box Case", "SV: Black Bolt"),
  cand("Ascended Heroes Mini Tin Display", "ME: Ascended Heroes"),
  cand("Ascended Heroes Mini Tin [Pikachu & Dachsbun]", "ME: Ascended Heroes"),
  cand("Ascended Heroes Mini Tin [Riolu & Dachsbun]", "ME: Ascended Heroes"),
  cand("Chaos Rising Booster Box", "ME04: Chaos Rising"),
  cand(
    "Prismatic Evolutions 2-Pack Blister [Eevee]",
    "SV: Prismatic Evolutions",
  ),
  cand("Prismatic Evolutions Surprise Box", "SV: Prismatic Evolutions"),
  cand("Prismatic Evolutions Elite Trainer Box", "SV: Prismatic Evolutions"),
  cand("Mega Dream ex Booster Box", "M2a: High Class Pack", { language: "ja" }),
]);

const item = (name: string, tags: string[] = []) => ({ name, tags });
const top = (name: string, tags: string[] = []) => {
  const r = matchItem(item(name, tags), catalog);
  return { status: r.status, best: r.options[0]?.candidate.name };
};

describe("tokens", () => {
  it("lowercases, drops filler words and punctuation", () => {
    expect(tokens("The Pokémon TCG: Black Bolt ETB!")).toEqual([
      "black",
      "bolt",
      "elite",
      "trainer",
      "box",
    ]);
  });
  it("expands ETB and the 2Blister spelling", () => {
    expect(tokens("Prismatic Evolutions 2Blister [Eevee]")).toEqual([
      "prismatic",
      "evolutions",
      "2",
      "pack",
      "blister",
      "eevee",
    ]);
  });
  it("drops '36 packs', which describes a box rather than a different product", () => {
    expect(tokens("Chaos Rising Booster Box 36 packs")).toEqual([
      "chaos",
      "rising",
      "booster",
      "box",
    ]);
  });
  it("handles accents, full-width letters and ASCII word boundaries", () => {
    // The Python matcher (pipeline/src/poke_pipeline/catalog_link.py) has the
    // same cases and must give the same answers.
    const expected: [string, string[]][] = [
      ["ßetb", ["elite", "trainer", "box"]],
      ["étb", ["elite", "trainer", "box"]],
      ["pokémon etb", ["elite", "trainer", "box"]],
      ["etb–box", ["elite", "trainer", "box", "box"]],
      ["ＥＴＢ", ["elite", "trainer", "box"]],
      ["x7etb", ["x7etb"]],
    ];
    for (const [text, words] of expected) expect(tokens(text)).toEqual(words);
  });
  it("copes with empty and symbol-only names", () => {
    expect(tokens("")).toEqual([]);
    expect(tokens("***")).toEqual([]);
  });
});

describe("isSealedCandidate", () => {
  it("rejects graded slabs and promos", () => {
    for (const n of [
      "slab psa 10 Charizard ex 349/190 jp",
      "psa 10 Pikachu",
      "Charizard PSA 9",
      "promo Mimikyu 075",
    ])
      expect(isSealedCandidate(item(n))).toBe(false);
    expect(isSealedCandidate(item("Anything", ["slab"]))).toBe(false);
  });
  it("accepts ordinary sealed product names", () => {
    expect(isSealedCandidate(item("Black Bolt Elite Trainer Box"))).toBe(true);
    expect(isSealedCandidate(item("Psyduck tin"))).toBe(true);
  });
});

describe("matchItem", () => {
  it("is confident for an exact product, including the ETB abbreviation", () => {
    expect(top("Black Bolt Elite Trainer Box")).toEqual({
      status: "confident",
      best: "Black Bolt Elite Trainer Box",
    });
    expect(top("Black Bolt ETB").best).toBe("Black Bolt Elite Trainer Box");
  });

  it("keeps a booster box apart from its case and from the bundle", () => {
    expect(top("Black Bolt Booster Box").best).toBe("Black Bolt Booster Box");
    expect(top("Black Bolt Booster Bundle").best).toBe(
      "Black Bolt Booster Bundle",
    );
    expect(top("Black Bolt Elite Trainer Box").best).not.toContain("Case");
  });

  it("does not turn a single mini tin into the display of ten", () => {
    const r = matchItem(item("Ascended Heroes Mini Tin"), catalog);
    expect(r.options[0].candidate.name).not.toContain("Display");
    // Two tins differ only by Pokémon, so the person must choose.
    expect(r.status).toBe("ambiguous");
  });

  it("flags tied variants as ambiguous, with both offered", () => {
    const r = matchItem(item("Ascended Heroes Mini Tin"), catalog);
    const names = r.options.map((o) => o.candidate.name);
    expect(names).toContain("Ascended Heroes Mini Tin [Pikachu & Dachsbun]");
    expect(names).toContain("Ascended Heroes Mini Tin [Riolu & Dachsbun]");
  });

  it("picks the right tin once the Pokémon is named", () => {
    const r = matchItem(
      item("Ascended Heroes Mini Tin Pikachu Dachsbun"),
      catalog,
    );
    expect(r.options[0].candidate.name).toContain("Pikachu");
    expect(r.status).not.toBe("ambiguous");
  });

  it("ignores '36 packs' when matching a booster box", () => {
    expect(top("Chaos Rising Booster Box 36 packs")).toEqual({
      status: "confident",
      best: "Chaos Rising Booster Box",
    });
  });

  it("matches a blister written the short way", () => {
    expect(top("Prismatic Evolutions 2Blister [Eevee]").best).toBe(
      "Prismatic Evolutions 2-Pack Blister [Eevee]",
    );
  });

  it("finds Japanese products and reports their language", () => {
    const r = matchItem(item("Mega Dream ex Booster Box"), catalog);
    expect(r.options[0].candidate.language).toBe("ja");
    expect(r.status).toBe("confident");
  });

  it("does not match something unrelated", () => {
    expect(
      matchItem(item("Totally Different Product Name"), catalog).status,
    ).toBe("none");
  });

  it("never offers a slab or promo, whatever its words match", () => {
    expect(top("slab psa 10 Black Bolt Elite Trainer Box")).toEqual({
      status: "not_sealed",
      best: undefined,
    });
  });

  it("returns at most three options, best first", () => {
    const r = matchItem(item("Black Bolt Elite Trainer Box"), catalog);
    expect(r.options.length).toBeLessThanOrEqual(3);
    const scores = r.options.map((o) => o.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("orders exact ties by product id so the answer never changes between loads", () => {
    const tied = prepareCatalog([
      cand("Same Name Box", "Set", { productId: 9002 }),
      cand("Same Name Box", "Set", { productId: 9001 }),
    ]);
    const r = matchItem(item("Same Name Box"), tied);
    expect(r.options.map((o) => o.candidate.productId)).toEqual([9001, 9002]);
    expect(r.status).toBe("ambiguous");
  });

  it("handles an empty catalogue and an empty name", () => {
    expect(matchItem(item("Black Bolt ETB"), []).status).toBe("none");
    expect(matchItem(item(""), catalog).status).toBe("none");
  });
});

describe("priceSanity", () => {
  it("accepts prices within a factor of two", () => {
    expect(priceSanity(100, 120)).toBe("ok");
    expect(priceSanity(100, 50)).toBe("ok");
    expect(priceSanity(100, 200)).toBe("ok");
  });
  it("flags a tenfold gap, the box-versus-case mistake", () => {
    expect(priceSanity(33, 283)).toBe("differs");
    expect(priceSanity(1500, 100)).toBe("differs");
  });
  it("says unknown when either price is missing or zero", () => {
    expect(priceSanity(null, 100)).toBe("unknown");
    expect(priceSanity(100, null)).toBe("unknown");
    expect(priceSanity(0, 100)).toBe("unknown");
  });
});

describe("isSealedCandidate and the word 'tag'", () => {
  it("treats a product that merely starts with Tag as sealed", () => {
    expect(isSealedCandidate({ name: "Tag Team Collection", tags: [] })).toBe(true);
    expect(isSealedCandidate({ name: "Tag Team GX All Stars Box", tags: [] })).toBe(true);
  });
  it("still treats a TAG-graded slab as a slab", () => {
    expect(isSealedCandidate({ name: "tag 10 oricorio ex 024", tags: [] })).toBe(false);
    expect(isSealedCandidate({ name: "TAG10 Pikachu", tags: [] })).toBe(false);
    expect(isSealedCandidate({ name: "slab tag 10 oricorio", tags: [] })).toBe(false);
  });
});
