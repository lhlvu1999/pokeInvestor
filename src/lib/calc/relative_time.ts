/**
 * Human-friendly age strings ("3h ago") for freshness indicators.
 *
 * Takes `now` as a parameter instead of reading the clock so callers stay
 * deterministic and tests don't depend on wall-clock time.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Whole-unit age: "just now", "5m ago", "3h ago", "2d ago", "3mo ago". */
export function formatAge(from: Date, now: Date): string {
  // A timestamp slightly in the future (clock skew between the DB host and
  // this process) must not render as a negative age.
  const ms = Math.max(0, now.getTime() - from.getTime());
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  const days = Math.floor(ms / DAY);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Fractional age in days. Never negative. */
export function ageInDays(from: Date, now: Date): number {
  return Math.max(0, now.getTime() - from.getTime()) / DAY;
}

/** Fractional age in hours. Never negative. */
export function ageInHours(from: Date, now: Date): number {
  return Math.max(0, now.getTime() - from.getTime()) / HOUR;
}
