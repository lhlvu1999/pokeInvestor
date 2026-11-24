import { NextResponse, type NextRequest } from "next/server";
import {
  clientIp,
  passwordMatches,
  readAuthConfig,
  safeNext,
  sessionExpiry,
  sessionKey,
  signSession,
} from "@/lib/calc/auth";
import {
  isHttps,
  loginThrottle,
  refuseCrossSite,
  see,
  sessionCookie,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const MAX_PASSWORD_CHARS = 1000;
/** A pause after a wrong password, so guessing is slow even before the limit bites. */
const WRONG_PASSWORD_DELAY_MS = 400;

/**
 * POST /api/auth/login  (form: password, next)
 *
 * Replies with a redirect either way, so the password is never in a URL and a
 * wrong one lands back on the login page.
 */
export async function POST(req: NextRequest) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  const cfg = readAuthConfig(process.env);
  const form = await req.formData().catch(() => null);
  const next = safeNext(String(form?.get("next") ?? ""));
  const back = (error: string) =>
    see(`/login?error=${error}${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);

  if (cfg.mode === "off") return see(next);
  if (cfg.mode === "broken") return back("config");

  const now = Date.now();
  const ip = clientIp(req.headers);
  if (loginThrottle.retryAfter(ip, now) > 0) return back("locked");

  const typed = form?.get("password");
  const ok =
    typeof typed === "string" &&
    typed.length <= MAX_PASSWORD_CHARS &&
    (await passwordMatches(typed, cfg.password));
  if (!ok) {
    loginThrottle.fail(ip, now);
    await new Promise((r) => setTimeout(r, WRONG_PASSWORD_DELAY_MS));
    return back("bad");
  }

  loginThrottle.succeed(ip);
  const token = await signSession(await sessionKey(cfg), sessionExpiry(now));
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: next, "Cache-Control": "no-store" },
  });
  res.cookies.set(sessionCookie(token, isHttps(req)));
  return res;
}
