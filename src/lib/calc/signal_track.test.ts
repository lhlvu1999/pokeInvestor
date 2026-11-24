import { describe, expect, it } from "vitest";
import {
  buildTrackRecord,
  dedupeSignals,
  scoreSignal,
  type RawMention,
  type Signal,
  type TrackParams,
} from "./signal_track";

const DAY = 86_400_000;
const NOW = new Date("2026-11-23T00:00:00Z");
const d = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);
const pt = (daysAgo: number, priceCents: number) => ({
  fetchedAt: d(daysAgo),
  priceCents,
});
const params: TrackParams = {
  horizonDays: 14,
  threshold: 0.05,
  maxGapDays: 3,
  now: NOW,
};
const sig = (o: Partial<Signal> = {}): Signal => ({
  videoId: "v1",
  channelId: "c1",
  channelTitle: "Creator One",
  itemId: "i1",
  itemName: "ETB",
  direction: "bullish",
  at: d(40),
  ...o,
});

describe("dedupeSignals", () => {
  const m = (o: Partial<RawMention> = {}): RawMention => ({
    videoId: "v1",
    channelId: "c1",
    channelTitle: "C",
    itemId: "i1",
    itemName: "ETB",
    sentiment: "bullish",
    at: d(30),
    ...o,
  });
  it("counts a video once per item however often it repeats itself", () => {
    expect(dedupeSignals([m(), m(), m()])).toHaveLength(1);
  });
  it("keeps separate items and separate videos apart", () => {
    expect(
      dedupeSignals([m(), m({ itemId: "i2" }), m({ videoId: "v2" })]),
    ).toHaveLength(3);
  });
  it("ignores neutral and mixed mentions", () => {
    expect(
      dedupeSignals([m({ sentiment: "neutral" }), m({ sentiment: "mixed" })]),
    ).toHaveLength(0);
  });
  it("drops a video that is both bullish and bearish on the same item", () => {
    expect(dedupeSignals([m(), m({ sentiment: "bearish" })])).toHaveLength(0);
  });
  it("keeps the bearish direction when that is the call", () => {
    expect(dedupeSignals([m({ sentiment: "bearish" })])[0].direction).toBe(
      "bearish",
    );
  });
});

describe("scoreSignal", () => {
  // Called 40 days ago; horizon lands 26 days ago.
  const hist = (before: number, after: number) => [
    pt(41, before),
    pt(26, after),
  ];

  it("counts a bullish call that rose by the threshold as a strict hit", () => {
    const o = scoreSignal(sig(), hist(100, 110), params);
    expect(o).toMatchObject({
      status: "scored",
      hit: true,
      rightWay: true,
      clearMiss: false,
    });
    expect(o.status === "scored" && o.movePct).toBeCloseTo(0.1);
  });

  it("does not count a small rise as a strict hit, only as right direction", () => {
    expect(scoreSignal(sig(), hist(100, 102), params)).toMatchObject({
      hit: false,
      rightWay: true,
      clearMiss: false,
    });
  });

  it("treats a flat price as neither a hit nor a miss", () => {
    expect(scoreSignal(sig(), hist(100, 100), params)).toMatchObject({
      hit: false,
      rightWay: false,
      clearMiss: false,
    });
  });

  it("flags a clear miss when the price went the other way", () => {
    expect(scoreSignal(sig(), hist(100, 90), params)).toMatchObject({
      hit: false,
      rightWay: false,
      clearMiss: true,
    });
  });

  it("scores a bearish call on a fall as a hit", () => {
    expect(
      scoreSignal(sig({ direction: "bearish" }), hist(100, 90), params),
    ).toMatchObject({
      hit: true,
      rightWay: true,
    });
  });

  it("will not score a call whose horizon has not arrived", () => {
    expect(
      scoreSignal(sig({ at: d(5) }), [pt(6, 100), pt(1, 120)], params),
    ).toEqual({
      status: "too_recent",
    });
  });

  it("needs a price shortly before the video", () => {
    expect(scoreSignal(sig(), [pt(60, 100), pt(26, 110)], params).status).toBe(
      "no_baseline",
    );
    expect(scoreSignal(sig(), [pt(26, 110)], params).status).toBe(
      "no_baseline",
    );
  });

  it("needs a fresh price near the horizon date", () => {
    expect(scoreSignal(sig(), [pt(41, 100), pt(35, 110)], params).status).toBe(
      "no_outcome",
    );
  });

  it("will not reuse the baseline as the outcome", () => {
    expect(scoreSignal(sig(), [pt(27, 100)], params).status).toBe(
      "no_baseline",
    );
    // baseline within the gap before the video, outcome date resolves to the same snapshot
    expect(scoreSignal(sig({ at: d(28) }), [pt(29, 100)], params).status).toBe(
      "no_outcome",
    );
  });

  it("will not divide by a zero baseline", () => {
    expect(scoreSignal(sig(), hist(0, 110), params).status).toBe("no_baseline");
  });
});

describe("buildTrackRecord", () => {
  const history = new Map([
    ["win", [pt(41, 100), pt(26, 120)]], // +20%
    ["flat", [pt(41, 100), pt(26, 101)]], // +1%
    ["lose", [pt(41, 100), pt(26, 80)]], // −20%
    ["none", [pt(10, 100)]],
  ]);
  const s = (itemId: string, o: Partial<Signal> = {}) =>
    sig({ itemId, videoId: `v-${itemId}`, ...o });

  const record = buildTrackRecord(
    [
      s("win"),
      s("flat"),
      s("lose"),
      s("none"),
      s("win", { videoId: "recent", at: d(3) }),
    ],
    history,
    params,
  );

  it("reports the strict rate first and the looser direction rate second", () => {
    expect(record.scored).toBe(3);
    expect(record.hits).toBe(1);
    expect(record.strictRate).toBeCloseTo(1 / 3);
    expect(record.rightWay).toBe(2); // win and flat(+1%) moved up
    expect(record.directionRate).toBeCloseTo(2 / 3);
    expect(record.strictRate!).toBeLessThanOrEqual(record.directionRate!);
  });

  it("separates clear misses from flat results", () => {
    expect(record.clearMisses).toBe(1);
    expect(record.flat).toBe(1);
  });

  it("says why calls were not scored", () => {
    expect(record.total).toBe(5);
    expect(record.notScored).toEqual({
      tooRecent: 1,
      noBaseline: 1,
      noOutcome: 0,
    });
  });

  it("measures what a random pick would have hit", () => {
    // For every scored call: of the OTHER priced items, how many rose ≥5%.
    // win → others {flat,lose} 0 of 2; flat → {win,lose} 1 of 2; lose → {win,flat} 1 of 2.
    expect(record.baseRate).toBeCloseTo((0 + 0.5 + 0.5) / 3);
  });

  it("splits bullish from bearish", () => {
    const r = buildTrackRecord(
      [s("win"), s("lose", { direction: "bearish" })],
      history,
      params,
    );
    expect(r.bullish).toMatchObject({ scored: 1, hits: 1, strictRate: 1 });
    expect(r.bearish).toMatchObject({ scored: 1, hits: 1, strictRate: 1 });
  });

  it("marks creators with too few scored calls as thin", () => {
    expect(record.creators).toHaveLength(1);
    expect(record.creators[0]).toMatchObject({
      scored: 3,
      hits: 1,
      thin: true,
    });
  });

  it("ranks established creators ahead of thin ones", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      s("win", { videoId: `big${i}`, channelId: "big", channelTitle: "Big" }),
    );
    const r = buildTrackRecord(
      [...many, s("win", { channelId: "tiny", channelTitle: "Tiny" })],
      history,
      params,
    );
    expect(r.creators.map((c) => c.channelId)).toEqual(["big", "tiny"]);
    expect(r.creators[0].thin).toBe(false);
  });

  it("lists recent scored calls newest first and caps the list", () => {
    // A daily series rising 2% a day, so every call has a baseline and an
    // outcome whatever day it was made.
    const daily = Array.from({ length: 50 }, (_, i) =>
      pt(70 - i, 100 * 1.02 ** i),
    );
    const calls = Array.from({ length: 5 }, (_, i) =>
      s("daily", { videoId: `x${i}`, at: d(40 + i) }),
    );
    const r = buildTrackRecord(calls, new Map([["daily", daily]]), params, 3);
    expect(r.scored).toBe(5);
    expect(r.recent).toHaveLength(3);
    expect(r.recent.map((c) => c.signal.videoId)).toEqual(["x0", "x1", "x2"]);
  });

  it("returns nulls rather than NaN when nothing could be scored", () => {
    const r = buildTrackRecord([s("none")], history, params);
    expect(r.scored).toBe(0);
    expect(r.strictRate).toBeNull();
    expect(r.directionRate).toBeNull();
    expect(r.baseRate).toBeNull();
  });
});
