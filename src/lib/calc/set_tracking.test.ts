import { describe, expect, it } from "vitest";
import { AGES } from "./age_curve";
import type { AgedSet } from "./card_curve";
import { trackSet, type SetDay } from "./set_tracking";

const grid = (at: Record<number, number>) => AGES.map((a) => at[a] ?? null);

/** Earlier sets: 100 priced cards, top-20 value 100 at day 14 and `v90` at day 90. */
const cohort = (v90s: number[]): AgedSet[] =>
  v90s.map((v90, i) => ({
    groupId: 100 + i,
    language: "en",
    priced: grid({ 14: 100, 90: 100, 180: 100 }),
    top20: grid({ 14: 100, 90: v90, 180: v90 * 1.1 }),
    top10: grid({ 14: 100, 90: v90 }),
    total: grid({ 14: 100, 90: v90 }),
  }));

const day = (d: string, priced: number, top20: number, over: Partial<SetDay> = {}): SetDay => ({
  day: d,
  priced,
  top20,
  top10: top20,
  total: top20,
  ...over,
});

// Released 2026-01-01; day 14 = 2026-01-15; day 90 = 2026-04-01.
const REL = "2026-01-01";
const five = cohort([80, 90, 100, 110, 120]);

const input = (days: SetDay[], over = {}) => ({
  groupId: 1,
  language: "en" as const,
  releasedOn: REL,
  days,
  ...over,
});

describe("trackSet", () => {
  it("compares the set's change since day 14 with earlier sets at the same age", () => {
    const t = trackSet(
      input([day("2026-01-15", 100, 100), day("2026-04-01", 100, 95)]),
      five,
    );
    expect(t.ageDays).toBe(90);
    expect(t.phase).toBe("early");
    const c = t.cards.find((x) => x.metric === "top20")!;
    expect(c.baseAge).toBe(14);
    expect(c.own).toBeCloseTo(-0.05, 10);
    expect(c.typical!.median).toBeCloseTo(0, 10);
    expect(c.typical!.sets).toBe(5);
    expect(c.position).toBe("within");
  });

  it("says below / above the middle half", () => {
    const below = trackSet(
      input([day("2026-01-15", 100, 100), day("2026-04-01", 100, 60)]),
      five,
    );
    expect(below.cards[0].position).toBe("below");
    const above = trackSet(
      input([day("2026-01-15", 100, 100), day("2026-04-01", 100, 160)]),
      five,
    );
    expect(above.cards[0].position).toBe("above");
  });

  it("won't compare when a card gained a price (priced count moved too much)", () => {
    const t = trackSet(
      input([day("2026-01-15", 60, 100), day("2026-04-01", 100, 300)]),
      five,
    );
    // Day 14 isn't comparable; no earlier base is in the history either.
    expect(t.cards).toEqual([]);
  });

  it("falls back to an earlier base when day 14 isn't comparable", () => {
    const t = trackSet(
      input([
        day("2026-01-01", 98, 120),
        day("2026-01-15", 60, 100),
        day("2026-04-01", 100, 150),
      ]),
      cohort([80, 90, 100, 110, 120]).map((s) => ({
        ...s,
        priced: grid({ 0: 100, 14: 100, 90: 100, 180: 100 }),
        top20: grid({ 0: 100, 14: 100, 90: 100 }),
      })),
    );
    const c = t.cards.find((x) => x.metric === "top20")!;
    expect(c.baseAge).toBe(0); // 7 isn't in the history, 14 isn't comparable
    expect(c.own).toBeCloseTo(150 / 120 - 1, 10);
  });

  it("leaves its own set out of the comparison", () => {
    const withSelf = [
      ...five,
      { ...cohort([5000])[0], groupId: 1 },
    ];
    const days = [day("2026-01-15", 100, 100), day("2026-04-01", 100, 95)];
    const a = trackSet(input(days), five);
    const b = trackSet(input(days), withSelf);
    expect(b.cards).toEqual(a.cards);
    expect(b.forward).toEqual(a.forward);
  });

  it("looks ahead from this age using earlier sets", () => {
    const t = trackSet(
      input([day("2026-01-15", 100, 100), day("2026-04-01", 100, 95)]),
      five,
    );
    expect(t.forward).toHaveLength(1); // 90 → 180 exists; 90 → 270 does not
    expect([t.forward[0].fromAge, t.forward[0].toAge]).toEqual([90, 180]);
    expect(t.forward[0].median).toBeCloseTo(0.1, 10);
    expect(t.forward[0].sets).toBe(5);
  });

  it("only compares the same language", () => {
    const t = trackSet(
      input([day("2026-01-15", 100, 100), day("2026-04-01", 100, 95)], {
        language: "ja",
      }),
      five,
    );
    expect(t.cards[0].typical).toBeNull();
    expect(t.cards[0].position).toBeNull();
    expect(t.forward).toEqual([]);
  });

  it("has nothing for an unknown release, no history, or an unreleased set", () => {
    const days = [day("2026-04-01", 100, 95)];
    expect(trackSet(input(days, { releasedOn: null }), five).ageDays).toBeNull();
    expect(trackSet(input([]), five).ageDays).toBeNull();
    const pre = trackSet(input(days, { releasedOn: "2026-05-01" }), five);
    expect(pre.ageDays).toBe(-30);
    expect(pre.cards).toEqual([]);
    expect(pre.forward).toEqual([]);
  });

  it("skips a metric with no value", () => {
    const t = trackSet(
      input([
        day("2026-01-15", 100, 100, { top10: 0 }),
        day("2026-04-01", 100, 95),
      ]),
      five,
    );
    expect(t.cards.map((c) => c.metric)).toEqual(["top20", "total"]);
  });
});
