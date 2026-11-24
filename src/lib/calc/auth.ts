/**
 * The rules of the optional login. Pure, and built on Web Crypto only, so the
 * same code runs in the proxy and in route handlers.
 *
 * Off by default: with no `APP_PASSWORD` the app is open, exactly as before, which
 * is right on your own machine. Set one and every page, API route and server
 * action needs a signed-in session. There is one password and no accounts.
 *
 * A session is a cookie holding an expiry time and a signature over it. The
 * signing key never leaves the server: it comes from `APP_SESSION_SECRET` when
 * set, otherwise it is stretched from the password with PBKDF2, so a stolen
 * cookie cannot be turned back into the password cheaply. Changing either
 * signs everyone out.
 */

export const SESSION_COOKIE = "pi_session";
export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 8;
export const MIN_SECRET_LENGTH = 16;

const DAY_MS = 86_400_000;
const enc = new TextEncoder();

export type AuthConfig =
  | { mode: "off" }
  /** A password is set but too weak to accept: nothing is let through. */
  | { mode: "broken"; reason: string }
  | { mode: "on"; password: string; secret: string | null };

type Env = Record<string, string | undefined>;

export function readAuthConfig(env: Env): AuthConfig {
  const password = env.APP_PASSWORD ?? "";
  if (password.trim() === "") return { mode: "off" };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      mode: "broken",
      reason: `APP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  const secret = env.APP_SESSION_SECRET ?? "";
  if (secret !== "" && secret.length < MIN_SECRET_LENGTH) {
    return {
      mode: "broken",
      reason: `APP_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters (or left unset).`,
    };
  }
  return { mode: "on", password, secret: secret === "" ? null : secret };
}

// ── Signing ────────────────────────────────────────────────────────────────

const b64url = (bytes: ArrayBuffer): string => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = (s: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};

const keys = new Map<string, Promise<CryptoKey>>();

/** The HMAC key sessions are signed with (cached: PBKDF2 is deliberately slow). */
export function sessionKey(
  cfg: Extract<AuthConfig, { mode: "on" }>,
): Promise<CryptoKey> {
  const id = `${cfg.secret ?? ""}\u0000${cfg.secret ? "" : cfg.password}`;
  let k = keys.get(id);
  if (!k) {
    k = (async () => {
      let raw: ArrayBuffer;
      if (cfg.secret) {
        raw = await crypto.subtle.digest("SHA-256", enc.encode(cfg.secret));
      } else {
        const base = await crypto.subtle.importKey(
          "raw",
          enc.encode(cfg.password),
          "PBKDF2",
          false,
          ["deriveBits"],
        );
        raw = await crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            hash: "SHA-256",
            iterations: 100_000,
            salt: enc.encode("poke-investor-session-v1"),
          },
          base,
          256,
        );
      }
      return crypto.subtle.importKey(
        "raw",
        raw,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
    })();
    keys.set(id, k);
  }
  return k;
}

const payload = (expiresAt: number) => enc.encode(`session:${expiresAt}`);

/** A session token valid until `expiresAt` (ms since the epoch). */
export async function signSession(
  key: CryptoKey,
  expiresAt: number,
): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", key, payload(expiresAt));
  return `${expiresAt}.${b64url(mac)}`;
}

/** True only for an untampered, unexpired token that this key signed. */
export async function verifySession(
  key: CryptoKey,
  token: string | undefined | null,
  now: number,
): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const expRaw = token.slice(0, dot);
  if (!/^\d{10,15}$/.test(expRaw)) return false;
  const expiresAt = Number(expRaw);
  // Expired, or further ahead than we ever issue (a forged far-future expiry).
  if (expiresAt <= now) return false;
  if (expiresAt - now > SESSION_DAYS * DAY_MS + 3_600_000) return false;
  const mac = fromB64url(token.slice(dot + 1));
  if (!mac) return false;
  return crypto.subtle.verify("HMAC", key, mac, payload(expiresAt));
}

export const sessionExpiry = (now: number): number =>
  now + SESSION_DAYS * DAY_MS;

/** Compare a typed password with the real one without leaking where they differ. */
export async function passwordMatches(
  input: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i] ?? 0);
  return diff === 0;
}

// ── Where a request may go ─────────────────────────────────────────────────

/**
 * Paths reachable without signing in: the login page and the call it makes, and
 * the scheduler's price refresh, which has no session and is guarded by its own
 * token instead (see app/api/cron/refresh-prices).
 */
export function isPublicPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return p === "/login" || p === "/api/auth/login" || p === "/api/cron/refresh-prices";
}

/**
 * Where to go after signing in. Only a path on this site: anything that could
 * lead elsewhere (an absolute URL, `//host`, a backslash trick) becomes "/".
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 500) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\"))
    return "/";
  if (/[\u0000-\u001f]/.test(raw)) return "/";
  try {
    const u = new URL(raw, "http://local.invalid");
    if (u.origin !== "http://local.invalid") return "/";
    const path = u.pathname + u.search;
    // Dot-segments are resolved above, so "/a/..//evil.example" has become
    // "//evil.example", which a browser reads as another site. Check the
    // RESULT, not just the input.
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
      return "/";
    }
    // Never bounce back to the login page itself or to the auth endpoints.
    return isPublicPath(u.pathname) ? "/" : path;
  } catch {
    return "/";
  }
}

/** The caller's address as best the proxy in front of us says; "unknown" if none. */
export function clientIp(headers: {
  get(name: string): string | null;
}): string {
  const fwd = headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}

// ── Slowing down guessing ──────────────────────────────────────────────────

export const THROTTLE_MAX_FAILS = 5;
export const THROTTLE_WINDOW_MS = 15 * 60_000;
/** Across everyone: a guesser rotating addresses still runs into this. */
export const THROTTLE_GLOBAL_MAX = 60;

/**
 * Remembers wrong passwords in memory. After a few from one address, that
 * address waits out the rest of the window; a much larger total across all
 * addresses locks everyone out for the window. A correct password clears the
 * address. In memory means it resets when the server restarts, and each server
 * instance counts on its own.
 */
export class LoginThrottle {
  private byIp = new Map<string, { fails: number; since: number }>();
  private global = { fails: 0, since: 0 };

  private fresh<T extends { since: number }>(
    e: T | undefined,
    now: number,
  ): T | undefined {
    return e && now - e.since < THROTTLE_WINDOW_MS ? e : undefined;
  }

  /** Seconds to wait before another try from `ip`, or 0 if it may try now. */
  retryAfter(ip: string, now: number): number {
    const g = this.fresh(this.global, now);
    if (g && g.fails >= THROTTLE_GLOBAL_MAX) {
      return Math.ceil((g.since + THROTTLE_WINDOW_MS - now) / 1000);
    }
    const e = this.fresh(this.byIp.get(ip), now);
    if (e && e.fails >= THROTTLE_MAX_FAILS) {
      return Math.ceil((e.since + THROTTLE_WINDOW_MS - now) / 1000);
    }
    return 0;
  }

  fail(ip: string, now: number): void {
    const e = this.fresh(this.byIp.get(ip), now);
    this.byIp.set(
      ip,
      e ? { fails: e.fails + 1, since: e.since } : { fails: 1, since: now },
    );
    const g = this.fresh(this.global, now);
    this.global = g
      ? { fails: g.fails + 1, since: g.since }
      : { fails: 1, since: now };
    // Keep the map from growing without bound.
    if (this.byIp.size > 5000) {
      for (const [k, v] of this.byIp)
        if (!this.fresh(v, now)) this.byIp.delete(k);
    }
  }

  succeed(ip: string): void {
    this.byIp.delete(ip);
  }
}
