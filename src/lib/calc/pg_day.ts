/**
 * Read a Postgres `timestamp` / `date` that means a calendar DAY (the
 * catalogue's price days) as that day at 00:00 UTC.
 *
 * Raw SQL returns such a column as text like "2026-11-22 00:00:00" with no
 * zone. `new Date("2026-11-22 00:00:00")` reads it as LOCAL midnight, which
 * for anyone east of UTC is the previous day in UTC, so a Nov 22 price was
 * shown as Nov 21. Parsing it as UTC keeps the day the sync wrote.
 */
export function utcDay(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Reject impossible dates such as 2026-02-31 (Date rolls them over).
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return d;
}
