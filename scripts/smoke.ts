/**
 * Visits every page and download of a running app and says which ones fail.
 * Read-only: it only makes GET requests.
 *
 *   npm run dev            (in another terminal)
 *   npm run smoke
 *
 * BASE_URL  where the app is (default http://localhost:3000)
 * SMOKE_PASSWORD  your APP_PASSWORD, if you turned the login on
 *
 * Exit code 0 when everything answers as expected, 1 otherwise.
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.SMOKE_PASSWORD;

const PAGES = [
  "/",
  "/items",
  "/items/new",
  "/items/tags",
  "/watchlist",
  "/offer",
  "/share",
  "/history",
  "/import",
  "/transactions/new",
  "/analytics",
  "/analytics/returns",
  "/analytics/vs-market",
  "/analytics/exposure",
  "/analytics/slabs",
  "/analytics/annual",
  "/analytics/stock",
  "/catalog",
  "/catalog/insights",
  "/catalog/calendar",
  "/catalog/compare",
  "/catalog/links",
  "/sources",
  "/insights",
  "/ask",
  "/stock-count",
  "/settings",
  "/settings/checklist",
  "/admin",
];
const DOWNLOADS = [
  "/api/export/transactions",
  "/api/export/sales",
  "/api/export/stock?date=" + new Date().toISOString().slice(0, 10),
];
/** Requests that must be refused, so a loosened check is noticed. */
const REFUSED: [string, number][] = [
  ["/api/export/sales?year=abc", 400],
  ["/api/export/stock?date=bad", 400],
  ["/api/items/not-a-uuid/image", 400],
  ["/api/cron/refresh-prices", 405], // exists, POST only (a POST needs the token)
];

let cookie = "";

async function get(path: string): Promise<{ status: number; text: string; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  return { status: res.status, text: await res.text(), ms: Date.now() - t0 };
}

async function signIn(): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({ password: PASSWORD ?? "" }),
  });
  const set = res.headers.get("set-cookie");
  if (!set) throw new Error("Sign-in failed: wrong SMOKE_PASSWORD, or the address is locked for a while.");
  cookie = set.split(";")[0];
}

async function main() {
  const probe = await fetch(BASE + "/items", { redirect: "manual" }).catch(() => null);
  if (!probe) {
    console.error(`Cannot reach ${BASE}. Is the app running?`);
    process.exit(1);
  }
  if (probe.status === 307 || probe.status === 308) {
    if (!PASSWORD) {
      console.error("The app asks for a login. Set SMOKE_PASSWORD to your APP_PASSWORD.");
      process.exit(1);
    }
    await signIn();
  }

  const problems: string[] = [];
  const slow: string[] = [];
  const check = async (path: string, want = 200) => {
    const r = await get(path);
    const ok = r.status === want;
    if (!ok) problems.push(`${path} -> ${r.status} (wanted ${want})`);
    if (r.ms > 3000) slow.push(`${path} ${r.ms} ms`);
    console.log(`${ok ? "ok  " : "FAIL"} ${String(r.status).padEnd(4)} ${String(r.ms).padStart(5)} ms  ${path}`);
    return r;
  };

  for (const p of PAGES) await check(p);
  for (const p of DOWNLOADS) await check(p);
  for (const [p, want] of REFUSED) await check(p, want);

  // Pages that need an id: take one from the lists, so this works on any data.
  const items = (await get("/items")).text;
  const item = /href="\/items\/([0-9a-f-]{36})"/.exec(items)?.[1];
  if (item) {
    await check(`/items/${item}`);
    await check(`/transactions/new?itemId=${item}`);
  } else console.log("skip  no items to open");
  const catalog = (await get("/catalog")).text;
  const set = /href="\/catalog\/sets\/(\d+)"/.exec(catalog)?.[1];
  if (set) await check(`/catalog/sets/${set}`);
  else console.log("skip  no sets to open");

  console.log(`\n${problems.length === 0 ? "All good" : `${problems.length} problem(s)`}${slow.length ? `; slow: ${slow.join(", ")}` : ""}`);
  for (const p of problems) console.log("  " + p);
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
