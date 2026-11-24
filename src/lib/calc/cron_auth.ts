/**
 * The key that lets a scheduler (not a signed-in person) ask the app to refresh
 * prices. Set `CRON_TOKEN` on the app and give the scheduler the same value; with
 * none set the endpoint does not exist. It is a bearer token: whoever holds it can
 * start a price refresh and nothing else.
 */

export const MIN_CRON_TOKEN_LENGTH = 32;

export type CronConfig =
  | { mode: "off" }
  | { mode: "broken"; reason: string }
  | { mode: "on"; token: string };

export function readCronConfig(env: Record<string, string | undefined>): CronConfig {
  const token = env.CRON_TOKEN ?? "";
  if (token.trim() === "") return { mode: "off" };
  if (token.length < MIN_CRON_TOKEN_LENGTH) {
    return {
      mode: "broken",
      reason: `CRON_TOKEN must be at least ${MIN_CRON_TOKEN_LENGTH} characters (try: openssl rand -hex 32).`,
    };
  }
  return { mode: "on", token };
}

/** The token from an `Authorization: Bearer ...` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}
