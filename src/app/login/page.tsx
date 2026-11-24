export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { readAuthConfig, safeNext } from "@/lib/calc/auth";

const MESSAGES: Record<string, string> = {
  bad: "That password isn't right.",
  locked: "Too many wrong tries. Wait a few minutes, then try again.",
};

/** The one place you can reach without signing in. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cfg = readAuthConfig(process.env);
  // No password set: there is nothing to sign in to.
  if (cfg.mode === "off") redirect("/");

  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const error = one(q.error);
  const next = safeNext(one(q.next));
  const message =
    cfg.mode === "broken"
      ? `${cfg.reason} Fix it in your environment settings and restart the app.`
      : error
        ? (MESSAGES[error] ?? null)
        : null;

  return (
    <div className="mx-auto mt-16 w-full max-w-sm">
      <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-card p-6">
        <h1 className="text-xl font-semibold tracking-tight">Poke Investor</h1>
        <p className="mt-1 text-sm text-zinc-500">Sign in to continue.</p>
        <form method="post" action="/api/auth/login" className="mt-5 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              required
              maxLength={1000}
              disabled={cfg.mode === "broken"}
              className="h-10 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </label>
          {message && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={cfg.mode === "broken"}
            className="h-10 rounded-md text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
