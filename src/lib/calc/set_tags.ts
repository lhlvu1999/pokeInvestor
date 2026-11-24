/**
 * Tags that take the catalogue's real set name.
 *
 * Your own tags for sets ("mega2.5", "pris", "surging") and the catalogue's set
 * for the same items are two names for one thing. This turns the catalogue's set
 * into a tag, works out which of your old tags mean which set, and applies the
 * change you choose: the old tag is renamed to the set's name.
 *
 * Nothing here guesses silently. An old tag is only offered for renaming when
 * EVERY item carrying it that has a known set agrees on that one set; a tag that
 * spans many sets ("etb", "case", "slab") is a kind of product, not a set, and is
 * left alone. How strong the evidence is gets shown, and thin evidence (one
 * linked item) is never pre-selected.
 */

/** Longest tag the app accepts. Real set names run to about 30 characters. */
export const MAX_TAG_LENGTH = 40;
/** Most tags one item can carry. */
export const MAX_TAGS_PER_ITEM = 12;

/**
 * The tag for a catalogue set: the set's name without its code prefix
 * ("ME: Ascended Heroes" -> "ascended heroes"), lower-case, with " (jp)" added
 * for Japanese sets so a Japanese and an English set of the same name stay
 * apart. Null when empty or too long to be a tag.
 *
 * Mirrored in pipeline/src/poke_pipeline/set_tags.py; both are tested against
 * pipeline/tests/fixtures/set_tag_vectors.json.
 */
export function setTagName(name: string, language: string): string | null {
  // A code prefix is letters/digits (and maybe a dash) before the first colon:
  // "SV8a:", "ME02:", "S-P:". Only the first one is removed, so "Crown Zenith:
  // Galarian Gallery" keeps the part after its second colon.
  const stripped = name.replace(/^\s*[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?\s*:\s*/, "");
  const base = stripped.trim().replace(/\s+/g, " ").toLowerCase();
  if (base === "") return null;
  const tag = language === "ja" ? `${base} (jp)` : base;
  return tag.length <= MAX_TAG_LENGTH ? tag : null;
}

/** `tags` plus `tag`, once, unless the item is already full. */
export function withTag(tags: readonly string[], tag: string): string[] {
  if (tags.includes(tag)) return [...tags];
  if (tags.length >= MAX_TAGS_PER_ITEM) return [...tags];
  return [...tags, tag];
}

export type PlanItem = {
  id: string;
  tags: readonly string[];
  /** The set tag of the item's catalogue set, or null when it has none. */
  setTag: string | null;
};

/** Words that make a tag a kind of product rather than a set ("etb", "jp box"). */
const PRODUCT_WORDS = new Set([
  "etb", "box", "booster", "case", "slab", "slabs", "collection", "bundle", "tin", "tins",
  "blister", "promo", "pin", "pins", "display", "deck", "binder", "figure", "poster",
  "stadium", "battle", "build", "bb", "center", "centre", "jp", "psa", "bgs", "cgc", "graded",
  "sealed", "pack", "packs", "sleeved",
]);

/** True when any word of the tag names a kind of product. */
export function looksLikeProduct(tag: string): boolean {
  return tag
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((w) => PRODUCT_WORDS.has(w));
}

export type TagProposal = {
  /** Your tag. */
  tag: string;
  /** The set tag it would be renamed to. */
  setTag: string;
  /** Items carrying the tag. */
  total: number;
  /** Of those, how many have a known set (all of them agree). */
  linked: number;
  /** Items that carry the tag but have no known set: renamed too. */
  unlinked: number;
  /** The tag names a kind of product ("bundle", "jp box"): probably not a set. */
  productLike: boolean;
  /** Enough to pre-select: two or more linked items agree and it is not product-like. */
  strong: boolean;
};

/**
 * Which of your tags are really sets. A tag is offered when every carrier with a
 * known set has the same one; a tag spread over several sets is a product type
 * and gets no proposal. Tags already equal to their set tag are skipped.
 */
export function planTagMerges(items: readonly PlanItem[]): TagProposal[] {
  const byTag = new Map<string, { sets: Map<string, number>; total: number }>();
  for (const it of items) {
    for (const tag of new Set(it.tags)) {
      const e = byTag.get(tag) ?? { sets: new Map<string, number>(), total: 0 };
      e.total += 1;
      if (it.setTag) e.sets.set(it.setTag, (e.sets.get(it.setTag) ?? 0) + 1);
      byTag.set(tag, e);
    }
  }
  const out: TagProposal[] = [];
  for (const [tag, e] of byTag) {
    if (e.sets.size !== 1) continue;
    const [[setTag, linked]] = [...e.sets];
    if (setTag === tag) continue;
    const productLike = looksLikeProduct(tag);
    out.push({
      tag,
      setTag,
      total: e.total,
      linked,
      unlinked: e.total - linked,
      productLike,
      strong: linked >= 2 && !productLike,
    });
  }
  return out.sort(
    (a, b) => Number(b.strong) - Number(a.strong) || b.linked - a.linked || a.tag.localeCompare(b.tag),
  );
}

export type TagChange = { id: string; before: string[]; after: string[] };

export type MergeResult = {
  changes: TagChange[];
  /** Items whose old tag was renamed. */
  renamed: number;
  /** Items that gained a set tag without losing a tag. */
  added: number;
  /** Items that could not take a set tag because they already carry 12 tags. */
  full: number;
};

/**
 * Apply the chosen renames, and optionally give every other item with a known
 * set its set tag. Renaming replaces the old tag in place; adding appends.
 * Returns only the items that actually change. `chosen` are the old tags.
 */
export function applyTagMerge(
  items: readonly PlanItem[],
  proposals: readonly TagProposal[],
  chosen: ReadonlySet<string>,
  alsoTagOthers: boolean,
): MergeResult {
  const picked = new Map(proposals.filter((p) => chosen.has(p.tag)).map((p) => [p.tag, p.setTag]));
  const res: MergeResult = { changes: [], renamed: 0, added: 0, full: 0 };
  for (const it of items) {
    const before = [...it.tags];
    let after: string[] = [];
    let renamedHere = false;
    for (const t of before) {
      const to = picked.get(t);
      if (to === undefined) {
        after.push(t);
      } else {
        renamedHere = true;
        after.push(to);
      }
    }
    after = [...new Set(after)];
    let addedHere = false;
    if (alsoTagOthers && it.setTag && !after.includes(it.setTag)) {
      if (after.length >= MAX_TAGS_PER_ITEM) res.full += 1;
      else {
        after.push(it.setTag);
        addedHere = true;
      }
    }
    if (after.length === before.length && after.every((t, i) => t === before[i])) continue;
    res.changes.push({ id: it.id, before, after });
    if (renamedHere) res.renamed += 1;
    else if (addedHere) res.added += 1;
  }
  return res;
}
