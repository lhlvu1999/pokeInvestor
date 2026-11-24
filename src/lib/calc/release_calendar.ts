/**
 * Sorting sets into "coming up" and "just out" for the release calendar.
 *
 * Dates come from TCGplayer's own listing. A date shared by many sets is a
 * bookkeeping stamp rather than a release, so those are ignored (the caller
 * passes them in), as are sets with no date.
 */

const DAY_MS = 86_400_000;

export type CalendarSet = {
  groupId: number;
  name: string;
  language: "en" | "ja";
  /** YYYY-MM-DD, or null when unknown. */
  releasedOn: string | null;
};

export type Dated<T> = T & {
  releasedOn: string;
  /** Days from `today` to release: positive before, negative after. */
  daysAway: number;
};

function dayNumber(day: string): number {
  return Math.round(
    Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) /
      DAY_MS,
  );
}

export type Calendar<T> = {
  /** Soonest first. Includes a set releasing today. */
  upcoming: Dated<T>[];
  /** Most recent first. */
  recent: Dated<T>[];
};

export function splitCalendar<T extends CalendarSet>(
  sets: ReadonlyArray<T>,
  today: string,
  options: {
    /** Dates to ignore (see `bulkReleaseDates`). */
    bulk?: ReadonlySet<string>;
    /** How far back "just out" reaches, in days. */
    recentDays?: number;
    /** How far ahead "coming up" reaches, in days. */
    horizonDays?: number;
  } = {},
): Calendar<T> {
  const { bulk = new Set<string>(), recentDays = 45, horizonDays = 400 } =
    options;
  const t = dayNumber(today);
  const upcoming: Dated<T>[] = [];
  const recent: Dated<T>[] = [];

  for (const s of sets) {
    if (!s.releasedOn || bulk.has(s.releasedOn)) continue;
    const daysAway = dayNumber(s.releasedOn) - t;
    const row = { ...s, releasedOn: s.releasedOn, daysAway };
    if (daysAway >= 0 && daysAway <= horizonDays) upcoming.push(row);
    else if (daysAway < 0 && daysAway >= -recentDays) recent.push(row);
  }
  upcoming.sort(
    (a, b) => a.daysAway - b.daysAway || a.groupId - b.groupId,
  );
  recent.sort((a, b) => b.daysAway - a.daysAway || a.groupId - b.groupId);
  return { upcoming, recent };
}

/** "today", "tomorrow", "in 5 days", "in 3 weeks", "yesterday", "12 days ago". */
export function whenLabel(daysAway: number): string {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  if (daysAway === -1) return "yesterday";
  const d = Math.abs(daysAway);
  const span =
    d < 14
      ? `${d} days`
      : d < 90
        ? `${Math.round(d / 7)} weeks`
        : `${Math.round(d / 30.4)} months`;
  return daysAway > 0 ? `in ${span}` : `${span} ago`;
}
