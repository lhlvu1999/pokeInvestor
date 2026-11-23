import { describe, expect, it } from "vitest";
import {
  pickMoversByImpact,
  priceMoveInWindow,
  summarizeActivity,
  summarizeValueChange,
  watchHits,
  windowBounds,
  type ActivityTx,
  type HeldInput,
} from "./changes";

const H = 3_600_000;
const NOW = new Date("2026-11-23T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);
const pt = (hours: number, priceCents: number) => ({
  fetchedAt: ago(hours),
  priceCents,
});
const day = windowBounds("day", NOW);
const week = windowBounds("week", NOW);
const identity = (m: number) => m;

describe("windowBounds", () => {
  it("covers the trailing 24 hours and 7 days", () => {
    expect(NOW.getTime() - day.start.getTime()).toBe(24 * H);
    expect(NOW.getTime() - week.start.getTime()).toBe(168 * H);
    expect(day.end).toEqual(NOW);
  });
});

describe("priceMoveInWindow", () => {
  it("compares the last snapshot before the window with the latest", () => {
    const r = priceMoveInWindow(
      [pt(50, 100), pt(30, 110), pt(2, 120)],
      day.start,
      day.end,
    );
    expect(r.kind).toBe("moved");
    if (r.kind === "moved") {
      expect(r.move.fromCents).toBe(110); // 30h ago, the last before the window
      expect(r.move.toCents).toBe(120);
      expect(r.move.changePct).toBeCloseTo(10 / 110);
    }
  });

  it("is not a move when nothing was refreshed inside the window", () => {
    expect(
      priceMoveInWindow([pt(50, 100), pt(30, 110)], day.start, day.end).kind,
    ).toBe("no_update");
  });

  it("needs something before the window to compare against", () => {
    expect(
      priceMoveInWindow([pt(5, 100), pt(2, 120)], day.start, day.end).kind,
    ).toBe("no_baseline");
  });

  it("does not divide by a zero baseline", () => {
    expect(
      priceMoveInWindow([pt(30, 0), pt(2, 120)], day.start, day.end).kind,
    ).toBe("no_baseline");
  });

  it("reports an unpriced item as empty", () => {
    expect(priceMoveInWindow([], day.start, day.end).kind).toBe("empty");
  });

  it("ignores snapshots after the window ends", () => {
    const future = { fetchedAt: new Date(NOW.getTime() + H), priceCents: 999 };
    const r = priceMoveInWindow(
      [pt(30, 100), pt(2, 110), future],
      day.start,
      day.end,
    );
    expect(r.kind === "moved" && r.move.toCents).toBe(110);
  });

  it("reports a flat price as a move of zero, not a missing one", () => {
    const r = priceMoveInWindow([pt(30, 100), pt(2, 100)], day.start, day.end);
    expect(r.kind === "moved" && r.move.changePct).toBe(0);
  });
});

describe("summarizeValueChange", () => {
  const held = (o: Partial<HeldInput> & { itemId: string }): HeldInput => ({
    name: o.itemId,
    imageUrl: null,
    quantity: 1,
    currency: "VND",
    history: [],
    ...o,
  });

  it("scales a unit move by the quantity held now", () => {
    const v = summarizeValueChange(
      [held({ itemId: "a", quantity: 3, history: [pt(30, 100), pt(2, 110)] })],
      day.start,
      day.end,
      identity,
    );
    expect(v.impact).toBe(30);
    expect(v.moved).toBe(1);
    expect(v.movers[0]).toMatchObject({ changePct: 0.1, impact: 30 });
  });

  it("counts every kind of item that could not be compared", () => {
    const v = summarizeValueChange(
      [
        held({ itemId: "stale", history: [pt(40, 100)] }),
        held({ itemId: "young", history: [pt(5, 100), pt(2, 110)] }),
        held({ itemId: "none" }),
        held({ itemId: "sold", quantity: 0, history: [pt(30, 1), pt(2, 5)] }),
      ],
      day.start,
      day.end,
      identity,
    );
    expect(v).toMatchObject({
      moved: 0,
      notRefreshed: 1,
      noBaseline: 1,
      unpriced: 1,
      impact: 0,
    });
  });

  it("leaves out an item it cannot convert instead of guessing", () => {
    const v = summarizeValueChange(
      [
        held({
          itemId: "usd",
          currency: "USD",
          history: [pt(30, 100), pt(2, 110)],
        }),
      ],
      day.start,
      day.end,
      (m, c) => (c === "USD" ? null : m),
    );
    expect(v.moved).toBe(0);
    expect(v.movers).toHaveLength(0);
  });

  it("nets gains against losses", () => {
    const v = summarizeValueChange(
      [
        held({ itemId: "up", history: [pt(30, 100), pt(2, 150)] }),
        held({
          itemId: "down",
          quantity: 2,
          history: [pt(30, 100), pt(2, 80)],
        }),
      ],
      day.start,
      day.end,
      identity,
    );
    expect(v.impact).toBe(50 - 40);
  });
});

describe("pickMoversByImpact", () => {
  const m = (itemId: string, impact: number) => ({
    itemId,
    name: itemId,
    imageUrl: null,
    quantity: 1,
    changePct: 0,
    impact,
    fromUnit: 0,
    toUnit: 0,
  });
  it("ranks by money effect, biggest first, per direction", () => {
    const { gainers, losers } = pickMoversByImpact(
      [m("a", 10), m("b", 300), m("c", -5), m("d", -90), m("e", 0)],
      2,
    );
    expect(gainers.map((x) => x.itemId)).toEqual(["b", "a"]);
    expect(losers.map((x) => x.itemId)).toEqual(["d", "c"]);
  });
  it("respects the limit and drops zero movers", () => {
    const { gainers, losers } = pickMoversByImpact(
      [m("a", 1), m("b", 2), m("z", 0)],
      1,
    );
    expect(gainers).toHaveLength(1);
    expect(losers).toHaveLength(0);
  });
});

describe("summarizeActivity", () => {
  const tx = (
    o: Partial<ActivityTx> & { id: string; hoursAgo: number },
  ): ActivityTx => ({
    itemId: o.id,
    name: o.id,
    type: "buy",
    quantity: 1,
    total: 100,
    exitReason: null,
    occurredAt: ago(o.hoursAgo),
    ...o,
  });

  it("splits buys, sales and exits, and ignores what is outside the window", () => {
    const a = summarizeActivity(
      [
        tx({ id: "b1", hoursAgo: 2, quantity: 2, total: 200 }),
        tx({ id: "s1", hoursAgo: 3, type: "sell", quantity: 1, total: 500 }),
        tx({
          id: "g1",
          hoursAgo: 4,
          type: "sell",
          quantity: 3,
          total: 0,
          exitReason: "gifted",
        }),
        tx({ id: "old", hoursAgo: 30 }),
      ],
      day.start,
      day.end,
    );
    expect(a.buys).toEqual({ count: 1, units: 2, total: 200 });
    expect(a.sells).toEqual({ count: 1, units: 1, total: 500 });
    expect(a.exits).toEqual({ count: 1, units: 3 });
    expect(a.recent.map((t) => t.id)).toEqual(["b1", "s1", "g1"]);
  });

  it("caps the recent list, newest first", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      tx({ id: `t${i}`, hoursAgo: i + 1 }),
    );
    const a = summarizeActivity(many, week.start, week.end, 5);
    expect(a.recent).toHaveLength(5);
    expect(a.recent[0].id).toBe("t0");
    expect(a.buys.count).toBe(12);
  });
});

describe("watchHits", () => {
  const entry = (history: ReturnType<typeof pt>[], o = {}) => ({
    name: "ETB",
    itemId: "i",
    targetCents: 100,
    currency: "VND",
    history,
    priceCurrency: "VND",
    ...o,
  });

  it("flags an item that dropped to the target during the window", () => {
    const [hit] = watchHits(
      [entry([pt(30, 120), pt(2, 95)])],
      day.start,
      day.end,
    );
    expect(hit).toMatchObject({ priceCents: 95, isNew: true });
  });

  it("lists an item already under target, but not as new", () => {
    const [hit] = watchHits(
      [entry([pt(30, 90), pt(2, 95)])],
      day.start,
      day.end,
    );
    expect(hit.isNew).toBe(false);
  });

  it("cannot call it new without a price from before the window", () => {
    const [hit] = watchHits([entry([pt(2, 95)])], day.start, day.end);
    expect(hit.isNew).toBe(false);
  });

  it("skips items above target, unpriced, or priced in another currency", () => {
    expect(
      watchHits(
        [
          entry([pt(2, 150)]),
          entry([]),
          entry([pt(2, 50)], { priceCurrency: "USD" }),
          entry([pt(2, 50)], { targetCents: 0 }),
        ],
        day.start,
        day.end,
      ),
    ).toHaveLength(0);
  });

  it("puts newly crossed entries first", () => {
    const hits = watchHits(
      [
        entry([pt(30, 90), pt(2, 90)], { name: "old" }),
        entry([pt(30, 150), pt(2, 90)], { name: "fresh" }),
      ],
      day.start,
      day.end,
    );
    expect(hits.map((h) => h.name)).toEqual(["fresh", "old"]);
  });
});
