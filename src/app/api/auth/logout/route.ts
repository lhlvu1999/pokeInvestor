import { NextResponse, type NextRequest } from "next/server";
import { clearedCookie, isHttps } from "@/lib/server/auth";
import { refuseCrossSite } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout: forget the session on this browser. */
export async function POST(req: NextRequest) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: "/login", "Cache-Control": "no-store" },
  });
  res.cookies.set(clearedCookie(isHttps(req)));
  return res;
}
