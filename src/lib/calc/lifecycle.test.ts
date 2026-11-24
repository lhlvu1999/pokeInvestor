import { describe, expect, it } from "vitest";
import { AGES, type AgedProduct } from "./age_curve";
import {
  ageLabel,
  buildLifecycle,
  phaseFor,
  spanLabel,
  type LifecycleInput,
} from "./lifecycle";

const prices = (at: Record<number, number>) => AGES.map((a) => at[a] ?? null);

/** A cohort of boxes that all cost 100 on day 7 and `p` at day 90 and 180. */
function cohort(
  day90: number[],
  day180: number[] = day90.map((p) => p * 1.2),
): AgedProduct[] {
  return day90.map((p, i) => ({
    groupId: 100 + i,
    language: "en",
    type: "box",
    prices: prices({ 0: 100, 7: 100, 30: 100, 90: p, 180: day180[i] }),
  }));
}

const input = (over: Partial<LifecycleInput> = {}): LifecycleInput => ({
  groupId: 1,
  language: "en",
  kind: "box",
  releasedOn: "2026-01-01",
  latest: { day: "2026-04-01", cents: 90 }, // 90 days later
  prices: prices({ 0: 100, 7: 100, 30: 95 }),
  ...over,
});

describe("phaseFor", () => {
  it.each([
    [-1, "upcoming"],
    [0, "launch"],
    [29, "launch"],
    [30, "early"],
    [179, "early"],
    [180, "first_year"],
    [364, "first_year"],
    [365, "established"],
    [2000, "established"],
  ])("%i days is %s", (age, phase) => {
    expect(phaseFor(age)).toBe(phase);
  });
});

describe("buildLifecycle", () => {
  const five = cohort([80, 90, 100, 110, 120]);

  it("works out age and phase from the release and latest price days", () => {
    const l = buildLifecycle(input(), five);
    expect(l.ageDays).toBe(90);
    expect(l.phase).toBe("early");
  });

  it("measures its own move from day 7 and compares it with the cohort", () => {
    const l = buildLifecycle(
      input({ latest: { day: "2026-04-01", cents: 95 } }),
      five,
    );
    expect(l.own!.baseAge).toBe(7);
    expect(l.own!.baseCents).toBe(100);
    expect(l.own!.latestCents).toBe(95);
    expect(l.own!.change).toBeCloseTo(-0.05, 10);
    // Cohort at day 90 vs day 7: -20%, -10%, 0, +10%, +20% (median 0).
    expect(l.typical!.median).toBeCloseTo(0, 10);
    expect(l.typical!.p25).toBeCloseTo(-0.1, 10);
    expect(l.typical!.p75).toBeCloseTo(0.1, 10);
    expect(l.typical!.sets).toBe(5);
    expect(l.position).toBe("within");
  });

  it("says below / above the middle half", () => {
    expect(
      buildLifecycle(input({ latest: { day: "2026-04-01", cents: 70 } }), five)
        .position,
    ).toBe("below");
    expect(
      buildLifecycle(input({ latest: { day: "2026-04-01", cents: 150 } }), five)
        .position,
    ).toBe("above");
  });

  it("interpolates the typical move for an age between lookup ages", () => {
    // 75 days is on the grid; use 82 (between 75 and 90). Only 90 has data in
    // this cohort, so there are no adjacent points and it can't be compared.
    const l = buildLifecycle(
      input({ latest: { day: "2026-03-24", cents: 90 } }),
      five,
    );
    expect(l.ageDays).toBe(82);
    expect(l.typical).toBeNull();
    expect(l.position).toBeNull();
  });

  it("falls back to release day when there's no day-7 price", () => {
    const l = buildLifecycle(input({ prices: prices({ 0: 120 }) }), five);
    expect(l.own!.baseAge).toBe(0);
    expect(l.own!.change).toBeCloseTo(90 / 120 - 1, 10);
  });

  it("has no own move when no early price is known", () => {
    const l = buildLifecycle(input({ prices: prices({}) }), five);
    expect(l.own).toBeNull();
    expect(l.typical).toBeNull();
    expect(l.position).toBeNull();
  });

  it("looks forward from the nearest lookup age using earlier sets", () => {
    const l = buildLifecycle(input(), five);
    expect(l.forward).toHaveLength(1); // 90 → 180 exists; 90 → 270 has no data
    const f = l.forward[0];
    expect([f.fromAge, f.toAge]).toEqual([90, 180]);
    expect(f.median).toBeCloseTo(0.2, 10); // every set rose 20% from 90 to 180
    expect(f.shareUp).toBe(1);
    expect(f.sets).toBe(5);
  });

  it("leaves its own set out of the comparison", () => {
    const withSelf = [
      ...five,
      {
        groupId: 1, // the product's own set, wildly different
        language: "en" as const,
        type: "box" as const,
        prices: prices({ 7: 100, 90: 1000, 180: 5000 }),
      },
    ];
    const a = buildLifecycle(input(), five);
    const b = buildLifecycle(input(), withSelf);
    expect(b.typical).toEqual(a.typical);
    expect(b.forward).toEqual(a.forward);
  });

  it("only compares the same language", () => {
    const l = buildLifecycle(input({ language: "ja" }), five);
    expect(l.typical).toBeNull();
    expect(l.forward).toEqual([]);
  });

  it("gives age but no comparison for a kind the curves don't cover", () => {
    const l = buildLifecycle(input({ kind: null }), five);
    expect(l.ageDays).toBe(90);
    expect(l.own).not.toBeNull();
    expect(l.typical).toBeNull();
    expect(l.forward).toEqual([]);
  });

  it("looks ahead from a pre-order age for a product that isn't out yet", () => {
    // Earlier sets all cost 100 a week before release and reached
    // 80..120 by day 90.
    const preorder = [80, 90, 100, 110, 120].map((p, i) => ({
      groupId: 200 + i,
      language: "en" as const,
      type: "box" as const,
      prices: prices({ [-7]: 100, 0: 110, 90: p }),
    }));
    const l = buildLifecycle(
      input({
        releasedOn: "2026-04-11",
        latest: { day: "2026-04-01", cents: 130 },
        prices: prices({}),
      }),
      preorder,
    );
    expect(l.ageDays).toBe(-10);
    expect(l.phase).toBe("upcoming");
    expect(l.own).toBeNull();
    // 10 days out snaps to the 7-days-before lookup age.
    const f = l.forward.find((x) => x.toAge === 90)!;
    expect(f.fromAge).toBe(-7);
    expect(f.median).toBeCloseTo(0, 10);
    expect(f.sets).toBe(5);
  });

  it("returns nothing for an unknown release or price", () => {
    expect(
      buildLifecycle(input({ releasedOn: null }), five).ageDays,
    ).toBeNull();
    const none = buildLifecycle(input({ latest: null }), five);
    expect(none.ageDays).toBeNull();
    expect(none.forward).toEqual([]);
  });
});

describe("labels", () => {
  it("describes age", () => {
    expect(ageLabel(-5)).toBe("out in 5 days");
    expect(ageLabel(-1)).toBe("out in 1 day");
    expect(ageLabel(1)).toBe("1 day old");
    expect(ageLabel(21)).toBe("3 weeks old");
    expect(ageLabel(120)).toBe("4 months old");
    expect(ageLabel(548)).toBe("18 months old");
    expect(ageLabel(730)).toBe("2 years old");
  });
  it("describes a stretch", () => {
    expect(spanLabel(30)).toBe("next 30 days");
    expect(spanLabel(90)).toBe("next 3 months");
    expect(spanLabel(60)).toBe("next 2 months");
    expect(spanLabel(180)).toBe("next 6 months");
  });
});
