import { describe, expect, it } from "vitest";
import { MAX_SEARCH_WORDS, searchWords } from "./catalog_search";

describe("searchWords", () => {
  it("needs a few characters before it searches", () => {
    expect(searchWords("")).toEqual([]);
    expect(searchWords("et")).toEqual([]);
    expect(searchWords("   ")).toEqual([]);
  });

  it("spells out etb the way the catalogue does", () => {
    expect(searchWords("ETB Ascended Heroes")).toEqual([
      "elite", "trainer", "box", "ascended", "heroes",
    ]);
  });

  it("drops grading words and a lone grade, keeps the card", () => {
    expect(searchWords("slab psa 10 Charizard V SWSH050")).toEqual(["charizard", "v", "swsh050"]);
  });

  it("keeps a card number, with its leading zeros", () => {
    expect(searchWords("promo Mimikyu 075")).toEqual(["mimikyu", "075"]);
  });

  it("drops accents and punctuation", () => {
    expect(searchWords("Pokémon: Flareon-ex")).toEqual(["flareon", "ex"]);
  });

  it("ignores repeats and caps the number of words", () => {
    expect(searchWords("pikachu pikachu pikachu")).toEqual(["pikachu"]);
    expect(searchWords("aaa bbb ccc ddd eee fff ggg hhh")).toHaveLength(MAX_SEARCH_WORDS);
  });

  it("is empty when nothing but copy words were typed", () => {
    expect(searchWords("psa 10 slab")).toEqual([]);
  });
});
