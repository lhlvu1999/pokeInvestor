/**
 * Which kind of sealed product a TCGplayer name is, for comparing like with
 * like across sets ("how do booster boxes age" needs to leave tins, cases and
 * Pokémon Center exclusives out).
 *
 * Only the four mainstream kinds are tracked. Everything else (cases, half
 * boxes, mini tins, blisters, collections, exclusives, build & battle kits)
 * is `null`: its price behaves differently, and mixing it in would blur the
 * kinds worth watching.
 */

export type SealedType = "box" | "etb" | "bundle" | "pack";

export const SEALED_TYPES: ReadonlyArray<SealedType> = [
  "box",
  "etb",
  "bundle",
  "pack",
];

export const SEALED_TYPE_LABELS: Record<SealedType, string> = {
  box: "Booster boxes",
  etb: "Elite Trainer Boxes",
  bundle: "Booster bundles",
  pack: "Booster packs",
};

/** Words that make a product something other than the plain kind. */
const NOT_PLAIN =
  /\b(case|half|mini|display|build|battle|sleeved|blister|pokemon center|costco|target|walmart|exclusive|art bundle|set of|\d+\s*-?\s*pack)\b/i;

export function sealedType(name: string): SealedType | null {
  const n = name.toLowerCase();
  // "Booster Bundle Display" and "... Case" are multiples of the plain thing.
  if (NOT_PLAIN.test(n)) return null;
  if (/\bbooster box\b/.test(n)) return "box";
  if (/\belite trainer box\b/.test(n)) return "etb";
  if (/\bbooster bundle\b/.test(n)) return "bundle";
  if (/\bbooster pack\b/.test(n)) return "pack";
  return null;
}
