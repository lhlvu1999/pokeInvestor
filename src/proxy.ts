import { NextResponse, type NextRequest } from "next/server";
import { isAllowedHost, parseAllowedHosts } from "@/lib/calc/host_check";
import {
  SESSION_COOKIE,
  isPublicPath,
  readAuthConfig,
  sessionKey,
  verifySession,
} from "@/lib/calc/auth";

/**
 * The login gate. With no APP_PASSWORD set the app is open, as it has always
 * been, but only to this machine and your own network (see host_check). With one set, every page, API route and server action
 * needs a valid session cookie, except the login page and the call it makes.
 *
 * Server actions are POSTs to the page that uses them, so this matcher covers
 * them as long as it covers every page. It therefore excludes only Next's own
 * static files; a test pins that down.
 */
export async function proxy(req: NextRequest) {
  const cfg = readAuthConfig(process.env);
  if (cfg.mode === "off") {
    // No login: only answer to names that mean this machine or your network, so
    // a web page cannot use DNS rebinding to read the app (see calc/host_check).
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!isAllowedHost(host, parseAllowedHosts(process.env.APP_ALLOWED_HOSTS))) {
      return new NextResponse(
        "This address isn't allowed. The app has no login, so it only answers on this computer " +
          "and your own network. Set APP_PASSWORD to turn on a login, or list this name in " +
          "APP_ALLOWED_HOSTS.",
        { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.next();
  }

  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (cfg.mode === "on") {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (await verifySession(await sessionKey(cfg), token, Date.now())) {
      return NextResponse.next();
    }
  }

  // Not signed in. Programs (API calls, server actions, anything that is not a
  // plain page load) get a 401; a browser navigating gets the login page.
  const isPageLoad = (req.method === "GET" || req.method === "HEAD") &&
    !pathname.startsWith("/api/") &&
    !req.headers.has("next-action");
  if (!isPageLoad) {
    return NextResponse.json(
      { error: "Sign in required" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  const res = NextResponse.redirect(url);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  // Everything except Next's own static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
