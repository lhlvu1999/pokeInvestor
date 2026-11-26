import { NextResponse, type NextRequest } from "next/server";
import { clientIp, passwordMatches } from "@/lib/calc/auth";
import { bearerToken, readCronConfig } from "@/lib/calc/cron_auth";
import { runSucceeded } from "@/lib/calc/refresh_run";
import { loginThrottle, refuseCrossSite } from "@/lib/server/auth";
import { runScheduledRefresh } from "@/lib/server/scheduled_refresh";

export const dynamic = "force-dynamic";
// A full refresh makes about one eBay call per held item; allow the longest a
// Vercel function may run on any plan (it is ignored everywhere else).
export const maxDuration = 300;

const no = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/cron/refresh-prices        Authorization: Bearer <CRON_TOKEN>
 *
 * Lets a scheduler refresh market prices for the items you hold, the way the
 * "Update all prices" button does. It is open to the login gate (a scheduler has
 * no session) and guarded by the token instead. Without CRON_TOKEN it does not
 * exist. Wrong tokens count against the same limit as wrong passwords.
 */
export async function POST(req: NextRequest) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;

  const cfg = readCronConfig(process.env);
  if (cfg.mode === "off") return no(404, "Scheduled refresh is not set up (set CRON_TOKEN).");
  if (cfg.mode === "broken") return no(503, cfg.reason);

  const now = Date.now();
  const key = `cron:${clientIp(req.headers)}`;
  const wait = loginThrottle.retryAfter(key, now);
  if (wait > 0) {
    return NextResponse.json(
      { error: "Too many wrong tokens. Try again later." },
      { status: 429, headers: { "Retry-After": String(wait), "Cache-Control": "no-store" } },
    );
  }
  const given = bearerToken(req.headers.get("authorization"));
  if (!given || !(await passwordMatches(given, cfg.token))) {
    loginThrottle.fail(key, now);
    await new Promise((r) => setTimeout(r, 400));
    return no(401, "Missing or wrong token.");
  }
  loginThrottle.succeed(key);

  const result = await runScheduledRefresh();
  if (!result.ok) return no(result.status, result.error);
  return NextResponse.json(
    { ok: runSucceeded(result.summary), ...result.summary },
    { status: runSucceeded(result.summary) ? 200 : 502, headers: { "Cache-Control": "no-store" } },
  );
}
