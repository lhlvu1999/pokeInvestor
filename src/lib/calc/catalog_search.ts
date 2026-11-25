/**
 * Turn what someone types for an item ("etb ascended heroes", "slab psa 10 Charizard
 * V SWSH050") into the words to look for in the catalogue.
 *
 * Words that describe the copy rather than the product (a grading company, the
 * grade, "slab", "promo", a language tag) are dropped, and "etb" is spelled out the
 * way the catalogue writes it. Every remaining word has to appear in the product's
 * name, its set's name or its card number.
 */

import { tokens } from "./catalog_match";

const COPY_WORDS = new Set([
  "slab",
  "psa",
  "bgs",
  "cgc",
  "tag",
  "promo",
  "en",
  "eng",
  "english",
  "jpn",
  "japanese",
  "sealed",
  "new",
]);

/** At most this many words are used, so a pasted sentence can't build a huge query. */
export const MAX_SEARCH_WORDS = 6;
export const MIN_SEARCH_CHARS = 3;

export function searchWords(input: string): string[] {
  if (input.trim().length < MIN_SEARCH_CHARS) return [];
  const words = tokens(input).filter(
    // a lone 1-2 digit number is almost always a grade or a quantity
    (w) => !COPY_WORDS.has(w) && !/^\d{1,2}$/.test(w),
  );
  return Array.from(new Set(words)).slice(0, MAX_SEARCH_WORDS);
}
