import { connection } from "next/server";
import { readAuthConfig } from "@/lib/calc/auth";

/**
 * A sign-out button, shown only when a login is set up. Reads the setting on
 * every request (not at build time), so turning the login on or off needs only
 * a restart.
 */
export async function SignOutButton() {
  await connection();
  if (readAuthConfig(process.env).mode === "off") return null;
  return (
    <form method="post" action="/api/auth/logout">
      <button
        type="submit"
        title="Sign out"
        aria-label="Sign out"
        className="inline-flex h-9 items-center justify-center rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        Sign out
      </button>
    </form>
  );
}
