import { LoginThrottle, SESSION_COOKIE, SESSION_DAYS } from "@/lib/calc/auth";
import { isSameOriginRequest } from "@/lib/calc/same_origin";

/**
 * Shared by the login and logout routes. Plain module, not "use server".
 *
 * The throttle lives on `globalThis` so a hot reload in development does not
 * hand a guesser a fresh allowance.
 */
const g = globalThis as { __pokeLoginThrottle?: LoginThrottle };
export const loginThrottle = (g.__pokeLoginThrottle ??= new LoginThrottle());

/** True when the browser reached us over HTTPS (directly or via a proxy). */
export function isHttps(req: { nextUrl: { protocol: string }; headers: Headers }): boolean {
  return (
    req.nextUrl.protocol === "https:" ||
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
  );
}

/** Cookie settings: not readable by scripts, not sent cross-site, Secure on HTTPS. */
export function sessionCookie(value: string, secure: boolean) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export const clearedCookie = (secure: boolean) => ({
  name: SESSION_COOKIE,
  value: "",
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge: 0,
});

/** A redirect with a relative Location, so it works behind any proxy or host name. */
export function see(path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

/**
 * For route handlers that change something: a 403 when another website made the
 * request, or null to carry on. See calc/same_origin.ts.
 */
export function refuseCrossSite(req: { headers: Headers }): Response | null {
  const h = req.headers;
  const ok = isSameOriginRequest({
    origin: h.get("origin"),
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
    secFetchSite: h.get("sec-fetch-site"),
  });
  if (ok) return null;
  return Response.json(
    { error: "Cross-site request refused" },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
