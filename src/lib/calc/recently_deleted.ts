/** How long a deleted transaction stays restorable. */
export const DELETED_RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

/** When an archived row expires. */
export function expiresAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + DELETED_RETENTION_DAYS * DAY_MS);
}

/**
 * Whole days left before the archive entry is purged, never below 0 and
 * rounded up so "expires today" reads as 1 day until it really is gone.
 */
export function daysLeft(deletedAt: Date, now: Date): number {
  const ms = expiresAt(deletedAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

/** The oldest `deletedAt` still worth keeping at `now`. */
export function purgeBefore(now: Date): Date {
  return new Date(now.getTime() - DELETED_RETENTION_DAYS * DAY_MS);
}
