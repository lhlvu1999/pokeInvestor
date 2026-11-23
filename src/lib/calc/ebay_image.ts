/**
 * Choosing a product picture from eBay search results.
 *
 * The listings that survive price filtering are the ones that matched the
 * query (negative keywords and outlier trimming already removed
 * accessories and mismatches). Among them, the listing priced closest to
 * the estimate is the most typical match, so its photo is the safest one
 * to show as "the" picture for the item.
 */

export type ImageCandidate = {
  totalMinor: number;
  imageUrl: string | null;
};

/**
 * eBay serves the same photo at several sizes, selected by an `s-l<N>`
 * segment in the filename. Search results usually carry a small one
 * (s-l225); a 500px version stays sharp in a 40–64px thumbnail on a
 * high-density screen and in a larger detail view. Non-eBay-CDN URLs are
 * returned unchanged.
 */
export function upgradeEbayImageUrl(url: string): string {
  return url.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)(\?.*)?$/i, "/s-l500.$1$2");
}

export function pickRepresentativeImage(
  candidates: ReadonlyArray<ImageCandidate>,
  targetMinor: number,
): string | null {
  let best: ImageCandidate | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (!c.imageUrl) continue;
    const dist = Math.abs(c.totalMinor - targetMinor);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best?.imageUrl ? upgradeEbayImageUrl(best.imageUrl) : null;
}
