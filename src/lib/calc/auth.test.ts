import { describe, expect, it } from "vitest";
import {
  LoginThrottle,
  SESSION_DAYS,
  THROTTLE_GLOBAL_MAX,
  THROTTLE_MAX_FAILS,
  THROTTLE_WINDOW_MS,
  clientIp,
  isPublicPath,
  passwordMatches,
  readAuthConfig,
  safeNext,
  sessionExpiry,
  sessionKey,
  signSession,
  verifySession,
} from "./auth";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const DAY = 86_400_000;

describe("readAuthConfig", () => {
  it("is off when no password is set", () => {
    expect(readAuthConfig({})).toEqual({ mode: "off" });
    expect(readAuthConfig({ APP_PASSWORD: "" })).toEqual({ mode: "off" });
    expect(readAuthConfig({ APP_PASSWORD: "   " })).toEqual({ mode: "off" });
  });
  it("is on with a good password, with or without a secret", () => {
    expect(readAuthConfig({ APP_PASSWORD: "long-enough-pw" })).toEqual({
      mode: "on",
      password: "long-enough-pw",
      secret: null,
    });
    const c = readAuthConfig({ APP_PASSWORD: "long-enough-pw", APP_SESSION_SECRET: "x".repeat(16) });
    expect(c).toMatchObject({ mode: "on", secret: "x".repeat(16) });
  });
  it("fails closed on a weak password or secret, never open", () => {
    expect(readAuthConfig({ APP_PASSWORD: "short" }).mode).toBe("broken");
    expect(readAuthConfig({ APP_PASSWORD: "long-enough-pw", APP_SESSION_SECRET: "tiny" }).mode).toBe("broken");
  });
  it("does not trim a real password", () => {
    const c = readAuthConfig({ APP_PASSWORD: " spaces at ends " });
    expect(c).toMatchObject({ mode: "on", password: " spaces at ends " });
  });
});

describe("sessions", () => {
  const cfg = { mode: "on", password: "correct horse battery", secret: null } as const;

  it("accepts a token it just signed", async () => {
    const key = await sessionKey(cfg);
    const token = await signSession(key, sessionExpiry(NOW));
    expect(await verifySession(key, token, NOW)).toBe(true);
  });

  it("rejects an expired token", async () => {
    const key = await sessionKey(cfg);
    const token = await signSession(key, NOW - 1000);
    expect(await verifySession(key, token, NOW)).toBe(false);
    const edge = await signSession(key, NOW);
    expect(await verifySession(key, edge, NOW)).toBe(false);
  });

  it("rejects a tampered expiry or signature", async () => {
    const key = await sessionKey(cfg);
    const exp = sessionExpiry(NOW);
    const token = await signSession(key, exp);
    const mac = token.slice(token.indexOf(".") + 1);
    // Same signature, later expiry: a forged extension.
    expect(await verifySession(key, `${exp + DAY}.${mac}`, NOW)).toBe(false);
    // Same expiry, damaged signature.
    const flipped = mac.slice(0, -2) + (mac.endsWith("AA") ? "BB" : "AA");
    expect(await verifySession(key, `${exp}.${flipped}`, NOW)).toBe(false);
    expect(await verifySession(key, `${exp}.`, NOW)).toBe(false);
  });

  it("rejects a forged far-future expiry even with a valid signature", async () => {
    const key = await sessionKey(cfg);
    const far = await signSession(key, NOW + 400 * DAY);
    expect(await verifySession(key, far, NOW)).toBe(false);
    const ok = await signSession(key, NOW + SESSION_DAYS * DAY);
    expect(await verifySession(key, ok, NOW)).toBe(true);
  });

  it("rejects malformed tokens without throwing", async () => {
    const key = await sessionKey(cfg);
    for (const t of [undefined, null, "", ".", "abc", "123.abc", "x".repeat(300), "1.2.3", "9999999999999.!!!", "0000000000000.AAAA"]) {
      expect(await verifySession(key, t as string, NOW)).toBe(false);
    }
  });

  it("does not accept a token signed with another password or secret", async () => {
    const other = await sessionKey({ mode: "on", password: "a different password", secret: null });
    const key = await sessionKey(cfg);
    const token = await signSession(other, sessionExpiry(NOW));
    expect(await verifySession(key, token, NOW)).toBe(false);
    const withSecret = await sessionKey({ ...cfg, secret: "s".repeat(20) });
    const t2 = await signSession(withSecret, sessionExpiry(NOW));
    expect(await verifySession(key, t2, NOW)).toBe(false);
    expect(await verifySession(withSecret, t2, NOW)).toBe(true);
  });

  it("a secret keeps tokens valid across a password change", async () => {
    const secret = "stable-secret-0123456789";
    const a = await sessionKey({ mode: "on", password: "first password!", secret });
    const b = await sessionKey({ mode: "on", password: "second password!", secret });
    const t = await signSession(a, sessionExpiry(NOW));
    expect(await verifySession(b, t, NOW)).toBe(true);
  });

  it("tokens are not interchangeable between expiries", async () => {
    const key = await sessionKey(cfg);
    const t1 = await signSession(key, NOW + DAY);
    const t2 = await signSession(key, NOW + 2 * DAY);
    expect(t1).not.toBe(t2);
  });
});

describe("passwordMatches", () => {
  it("matches exactly", async () => {
    expect(await passwordMatches("hunter2hunter2", "hunter2hunter2")).toBe(true);
  });
  it("rejects anything else, including near misses and different lengths", async () => {
    expect(await passwordMatches("hunter2hunter3", "hunter2hunter2")).toBe(false);
    expect(await passwordMatches("hunter2hunter2 ", "hunter2hunter2")).toBe(false);
    expect(await passwordMatches("", "hunter2hunter2")).toBe(false);
    expect(await passwordMatches("HUNTER2HUNTER2", "hunter2hunter2")).toBe(false);
  });
  it("handles non-ASCII", async () => {
    expect(await passwordMatches("pässwörd-éé", "pässwörd-éé")).toBe(true);
    expect(await passwordMatches("pässwörd-éé", "passwörd-éé")).toBe(false);
  });
});

describe("isPublicPath", () => {
  it("allows only the login page and its call", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/")).toBe(true);
    expect(isPublicPath("/api/auth/login")).toBe(true);
  });
  it("also lets the scheduler's price refresh through, which checks its own token", () => {
    expect(isPublicPath("/api/cron/refresh-prices")).toBe(true);
    expect(isPublicPath("/api/cron/refresh-prices/")).toBe(true);
    expect(isPublicPath("/api/cron")).toBe(false);
    expect(isPublicPath("/api/cron/other")).toBe(false);
  });
  it("protects everything else, including look-alikes", () => {
    for (const p of ["/", "/items", "/api/export/backup", "/api/backup/restore", "/login/x", "/loginx", "/api/auth/logout", "/api/auth/login/x", "/settings", "/api/items/abc/image", "/api/cron/refresh-prices/x"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe("safeNext", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNext("/items?q=slab")).toBe("/items?q=slab");
    expect(safeNext("/analytics/slabs")).toBe("/analytics/slabs");
    expect(safeNext("/")).toBe("/");
  });
  it("turns anything that could leave the site into /", () => {
    for (const bad of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "///evil.example",
      "/%5Cevil.example/..//",
      "/a/..//evil.example",
      "/.//evil.example",
      "/..//evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "",
    ]) {
      const out = safeNext(bad);
      expect(out === "/" || (out.startsWith("/") && !out.startsWith("//"))).toBe(true);
      expect(out).not.toContain("evil");
    }
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("/" + "a".repeat(600))).toBe("/");
  });
  it("never sends you back to the login page or auth calls", () => {
    expect(safeNext("/login")).toBe("/");
    expect(safeNext("/login?next=/x")).toBe("/");
    expect(safeNext("/api/auth/login")).toBe("/");
  });
});

describe("clientIp", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  it("takes the first forwarded address, then the real-ip header", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(h({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(h({}))).toBe("unknown");
  });
});

describe("LoginThrottle", () => {
  it("lets a few wrong tries through, then makes that address wait", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < THROTTLE_MAX_FAILS; i++) {
      expect(t.retryAfter("a", NOW + i)).toBe(0);
      t.fail("a", NOW + i);
    }
    expect(t.retryAfter("a", NOW + 10)).toBeGreaterThan(0);
    expect(t.retryAfter("a", NOW + 10)).toBeLessThanOrEqual(THROTTLE_WINDOW_MS / 1000);
  });
  it("does not punish other addresses", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < THROTTLE_MAX_FAILS; i++) t.fail("a", NOW);
    expect(t.retryAfter("b", NOW)).toBe(0);
  });
  it("forgives after the window", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < THROTTLE_MAX_FAILS; i++) t.fail("a", NOW);
    expect(t.retryAfter("a", NOW + THROTTLE_WINDOW_MS + 1)).toBe(0);
  });
  it("a correct password clears the address", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < THROTTLE_MAX_FAILS - 1; i++) t.fail("a", NOW);
    t.succeed("a");
    t.fail("a", NOW);
    expect(t.retryAfter("a", NOW)).toBe(0);
  });
  it("locks everyone out when guesses come from many addresses", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < THROTTLE_GLOBAL_MAX; i++) t.fail(`ip${i}`, NOW);
    expect(t.retryAfter("brand-new", NOW + 1000)).toBeGreaterThan(0);
    expect(t.retryAfter("brand-new", NOW + THROTTLE_WINDOW_MS + 1)).toBe(0);
  });
});

describe("proxy matcher", () => {
  // The server-action warning in Next's docs: a matcher that skips a page also
  // skips that page's server actions. Pin down exactly what is skipped.
  it("covers every page, API route and data request except Next's static files", async () => {
    const { config } = await import("../../proxy");
    const [pattern] = config.matcher;
    const re = new RegExp(`^${pattern}$`);
    for (const p of ["/", "/items", "/items/abc", "/analytics/slabs", "/settings", "/login", "/api/auth/login", "/api/export/backup", "/api/backup/restore", "/api/items/x/image", "/_next/data/build/items.json", "/anything.png"]) {
      expect(re.test(p), p).toBe(true);
    }
    for (const p of ["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico"]) {
      expect(re.test(p), p).toBe(false);
    }
  });
});
