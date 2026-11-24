import { describe, expect, it } from "vitest";
import { splitCalendar, whenLabel, type CalendarSet } from "./release_calendar";

const set = (
  groupId: number,
  releasedOn: string | null,
  language: "en" | "ja" = "en",
): CalendarSet => ({ groupId, name: `Set ${groupId}`, language, releasedOn });

describe("splitCalendar", () => {
  const today = "2026-11-22";

  it("splits into coming up (soonest first) and just out (newest first)", () => {
    const c = splitCalendar(
      [
        set(1, "2027-02-06"),
        set(2, "2026-11-27", "ja"),
        set(3, "2026-11-06"),
        set(4, "2026-11-13", "ja"),
      ],
      today,
    );
    expect(c.upcoming.map((s) => [s.groupId, s.daysAway])).toEqual([
      [2, 5],
      [1, 76],
    ]);
    expect(c.recent.map((s) => [s.groupId, s.daysAway])).toEqual([
      [4, -9],
      [3, -16],
    ]);
  });

  it("counts a set releasing today as coming up", () => {
    const c = splitCalendar([set(1, "2026-11-22")], today);
    expect(c.upcoming).toHaveLength(1);
    expect(c.upcoming[0].daysAway).toBe(0);
    expect(c.recent).toHaveLength(0);
  });

  it("ignores unknown and bulk dates", () => {
    const c = splitCalendar(
      [set(1, null), set(2, "2026-11-22"), set(3, "2026-11-30")],
      today,
      { bulk: new Set(["2026-11-22"]) },
    );
    expect(c.upcoming.map((s) => s.groupId)).toEqual([3]);
    expect(c.recent).toEqual([]);
  });

  it("honours the windows", () => {
    const sets = [set(1, "2026-10-01"), set(2, "2028-01-01")];
    const none = splitCalendar(sets, today);
    expect(none.recent).toEqual([]); // 52 days ago, window is 45
    expect(none.upcoming).toEqual([]); // 405 days ahead, window is 400
    const wide = splitCalendar(sets, today, {
      recentDays: 60,
      horizonDays: 500,
    });
    expect(wide.recent).toHaveLength(1);
    expect(wide.upcoming).toHaveLength(1);
  });

  it("crosses month and year boundaries correctly", () => {
    const c = splitCalendar([set(1, "2027-01-03")], "2026-12-30");
    expect(c.upcoming[0].daysAway).toBe(4);
  });

  it("keeps extra fields on the rows", () => {
    const c = splitCalendar([{ ...set(1, "2026-11-25"), extra: 7 }], today);
    expect(c.upcoming[0].extra).toBe(7);
  });
});

describe("whenLabel", () => {
  it.each([
    [0, "today"],
    [1, "tomorrow"],
    [-1, "yesterday"],
    [5, "in 5 days"],
    [-9, "9 days ago"],
    [21, "in 3 weeks"],
    [-30, "4 weeks ago"],
    [76, "in 11 weeks"],
    [200, "in 7 months"],
  ])("%i → %s", (d, label) => {
    expect(whenLabel(d)).toBe(label);
  });
});
