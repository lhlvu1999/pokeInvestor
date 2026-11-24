/**
 * Refuse requests that a web page on another site made on your behalf.
 *
 * A page you happen to visit can make your browser send a POST to your own
 * app (cookies or no cookies; a local app with no login is just as exposed).
 * Next.js already checks the Origin of Server Actions; this does the same for
 * the route handlers that change things.
 *
 * Browsers always say where a request came from, in `Origin` or
 * `Sec-Fetch-Site`; programs like curl send neither, and they are not the
 * threat (an attacker's web page cannot make a browser leave these out).
 */

export type RequestOriginInfo = {
  origin: string | null;
  host: string | null;
  /** `X-Forwarded-Host`, set by a reverse proxy in front of the app. */
  forwardedHost?: string | null;
  secFetchSite?: string | null;
};

const first = (v: string | null | undefined) => v?.split(",")[0]?.trim().toLowerCase() || null;

/** True when the request plainly came from this site, or from no browser at all. */
export function isSameOriginRequest(r: RequestOriginInfo): boolean {
  const ours = first(r.forwardedHost) ?? first(r.host);
  if (r.origin !== null && r.origin !== undefined) {
    // "null" is what browsers send from sandboxed frames and some redirects.
    let theirs: string;
    try {
      theirs = new URL(r.origin).host.toLowerCase();
    } catch {
      return false;
    }
    return ours !== null && theirs === ours;
  }
  const site = first(r.secFetchSite);
  if (site === null) return true; // not a browser
  // "same-site" would let another port or subdomain through: not good enough.
  return site === "same-origin" || site === "none";
}
