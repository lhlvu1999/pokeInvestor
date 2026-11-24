/**
 * Which host names the app answers to while it has no login.
 *
 * With no password the app trusts "whoever can reach it", which is only safe if
 * only you can. A web page you visit can break that with DNS rebinding: its own
 * domain is pointed at your computer, so your browser treats the app as part of
 * that site and lets it read everything. The tell is the Host header: it is the
 * attacker's domain, not a name that means "this machine". So with the login off
 * the app answers only to names that mean this machine or your own network, plus
 * any you list in `APP_ALLOWED_HOSTS`. With a login on, this check is not used
 * (the attacker's site has no session), so a public domain just works.
 */

/** Suffixes that only ever mean a private network, never a public website. */
const PRIVATE_SUFFIXES = [".local", ".lan", ".home", ".internal", ".home.arpa", ".localhost"];

/** The host name from a Host header, lower-cased, without port or IPv6 brackets. */
export function hostName(header: string | null | undefined): string | null {
  const h = header?.split(",")[0]?.trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 1 ? h.slice(1, end) : null;
  }
  const colon = h.lastIndexOf(":");
  const name = colon === -1 ? h : h.slice(0, colon);
  return name.replace(/\.$/, "") || null;
}

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** True for a loopback or private-network address. */
export function isPrivateAddress(host: string): boolean {
  const v4 = ipv4(host);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (host.includes(":")) {
    return host === "::1" || host.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(host);
  }
  return false;
}

export function parseAllowedHosts(env: string | undefined): string[] {
  return (env ?? "")
    .split(",")
    .map((h) => hostName(h))
    .filter((h): h is string => !!h);
}

/**
 * Whether to answer a request, given its Host. Names that mean this machine or a
 * private network are always fine; a name with no dot (a machine on your network,
 * like "mac-mini") is too, since a public website cannot have one.
 */
export function isAllowedHost(hostHeader: string | null | undefined, extra: readonly string[]): boolean {
  const host = hostName(hostHeader);
  if (!host) return false;
  if (host === "localhost" || isPrivateAddress(host)) return true;
  if (extra.includes(host)) return true;
  if (!host.includes(".") && !host.includes(":")) return true;
  return PRIVATE_SUFFIXES.some((s) => host.endsWith(s));
}
