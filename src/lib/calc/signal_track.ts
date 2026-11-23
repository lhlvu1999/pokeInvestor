/**
 * Signal track record: did creators' calls turn out right?
 *
 * Each bullish or bearish call on an item we track is checked against the
 * item's own price history: the price when the video came out versus the
 * price one horizon later. The rules are deliberately strict, because the
 * easy way to flatter a signal source is to count a coin flip as a win.
 *
 * - STRICT hit: the price moved the called way by at least `threshold`.
 *   A flat result is NOT a hit, and the strict rate is the headline.
 *   "Right direction" (any move the called way) is shown second.
 * - A call is only scored with real prices around it: a snapshot shortly
 *   BEFORE the video (what was knowable then) and one shortly before the
 *   horizon date. Otherwise it is reported as not scorable and why, never
 *   guessed.
 * - A BASE RATE says how often an average tracked item moved that way over
 *   the same windows. A 45% hit rate means nothing if half of everything
 *   rose; the base rate is what a creator has to beat.
 * - One video counts once per item, however many times it repeats itself.
 *   A video both bullish and bearish on the same item is ambiguous and is
 *   left out.
 */

import { priceAsOf, type PricePoint } from "./price_history";

const DAY_MS = 86_400_000;

export type Direction = "bullish" | "bearish";

export type RawMention = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  itemId: string;
  itemName: string;
  sentiment: string;
  /** The video's real upload time. Callers must not pass a crawl time. */
  at: Date;
};

export type Signal = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  itemId: string;
  itemName: string;
  direction: Direction;
  at: Date;
};

/** One signal per (video, item); drops neutral/mixed and contradictions. */
export function dedupeSignals(mentions: ReadonlyArray<RawMention>): Signal[] {
  const seen = new Map<
    string,
    { m: RawMention; bull: boolean; bear: boolean }
  >();
  for (const m of mentions) {
    if (m.sentiment !== "bullish" && m.sentiment !== "bearish") continue;
    const k = `${m.videoId}|${m.itemId}`;
    const cur = seen.get(k) ?? { m, bull: false, bear: false };
    if (m.sentiment === "bullish") cur.bull = true;
    else cur.bear = true;
    seen.set(k, cur);
  }
  const out: Signal[] = [];
  for (const { m, bull, bear } of seen.values()) {
    if (bull === bear) continue; // both: contradictory
    out.push({
      videoId: m.videoId,
      channelId: m.channelId,
      channelTitle: m.channelTitle,
      itemId: m.itemId,
      itemName: m.itemName,
      direction: bull ? "bullish" : "bearish",
      at: m.at,
    });
  }
  return out;
}

export type TrackParams = {
  horizonDays: number;
  /** Fraction: 0.05 = a 5% move is needed for a strict hit. */
  threshold: number;
  /** A snapshot older than this (before the date it stands for) is stale. */
  maxGapDays: number;
  now: Date;
};

/** A price snapshot older than this, before the date it stands for, is stale. */
export const MAX_GAP_DAYS = 3;

export const HORIZON_OPTIONS = [7, 14, 30] as const;
export const DEFAULT_HORIZON_DAYS = 14;

/** How big a move counts as a strict hit. Sealed product moves slowly, so
 * the right bar depends on the horizon; the page lets you pick. */
export const THRESHOLD_OPTIONS = [0.02, 0.05, 0.1] as const;
export const DEFAULT_THRESHOLD = 0.05;

export type Outcome =
  | {
      status: "scored";
      movePct: number;
      /** Moved the called way by at least the threshold. */
      hit: boolean;
      /** Moved the called way at all. */
      rightWay: boolean;
      /** Moved the opposite way by at least the threshold. */
      clearMiss: boolean;
    }
  | { status: "too_recent" }
  | { status: "no_baseline" }
  | { status: "no_outcome" };

/** Last snapshot at or before `t`, if it is no older than `maxGapDays`. */
function priceNear(
  history: ReadonlyArray<PricePoint>,
  t: Date,
  maxGapDays: number,
): PricePoint | null {
  const p = priceAsOf(history, t);
  if (!p) return null;
  return t.getTime() - p.fetchedAt.getTime() <= maxGapDays * DAY_MS ? p : null;
}

/** Fractional move of one price series between two dates, or why not. */
function moveBetween(
  history: ReadonlyArray<PricePoint>,
  from: Date,
  to: Date,
  maxGapDays: number,
): { kind: "ok"; pct: number } | { kind: "no_baseline" | "no_outcome" } {
  const base = priceNear(history, from, maxGapDays);
  if (!base || base.priceCents <= 0) return { kind: "no_baseline" };
  const out = priceNear(history, to, maxGapDays);
  // The outcome must be a later observation, not the baseline again.
  if (!out || out.fetchedAt.getTime() <= base.fetchedAt.getTime()) {
    return { kind: "no_outcome" };
  }
  return {
    kind: "ok",
    pct: (out.priceCents - base.priceCents) / base.priceCents,
  };
}

export function scoreSignal(
  signal: Signal,
  history: ReadonlyArray<PricePoint>,
  p: TrackParams,
): Outcome {
  const target = new Date(signal.at.getTime() + p.horizonDays * DAY_MS);
  if (target.getTime() > p.now.getTime()) return { status: "too_recent" };
  const m = moveBetween(history, signal.at, target, p.maxGapDays);
  if (m.kind !== "ok") return { status: m.kind };
  const signed = signal.direction === "bullish" ? m.pct : -m.pct;
  return {
    status: "scored",
    movePct: m.pct,
    hit: signed >= p.threshold,
    rightWay: signed > 0,
    clearMiss: signed <= -p.threshold,
  };
}

/* ------------------------------------------------------------------ */
/* Scorecard                                                           */
/* ------------------------------------------------------------------ */

export type Tally = {
  scored: number;
  hits: number;
  rightWay: number;
};

export type CreatorTrack = Tally & {
  channelId: string;
  channelTitle: string;
  strictRate: number | null;
  /** Too few scored calls to say anything about this creator. */
  thin: boolean;
};

export type ScoredCall = {
  signal: Signal;
  movePct: number;
  hit: boolean;
  rightWay: boolean;
};

export type TrackRecord = {
  params: Omit<TrackParams, "now">;
  total: number;
  scored: number;
  /** Headline: strict hits ÷ scored. */
  strictRate: number | null;
  /** Second: moved the called way at all ÷ scored. */
  directionRate: number | null;
  hits: number;
  rightWay: number;
  clearMisses: number;
  /** Scored but flat (inside the threshold either way). */
  flat: number;
  notScored: { tooRecent: number; noBaseline: number; noOutcome: number };
  /**
   * Average share of OTHER tracked items that moved the called way by the
   * threshold over the same windows. What a random pick would hit.
   */
  baseRate: number | null;
  bullish: Tally & { strictRate: number | null };
  bearish: Tally & { strictRate: number | null };
  creators: CreatorTrack[];
  /** Most recent scored calls, newest first. */
  recent: ScoredCall[];
};

/** Fewer scored calls than this and a creator's rate is just noise. */
export const MIN_CREATOR_CALLS = 5;

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

export function buildTrackRecord(
  signals: ReadonlyArray<Signal>,
  historyByItem: ReadonlyMap<string, ReadonlyArray<PricePoint>>,
  p: TrackParams,
  recentLimit = 10,
): TrackRecord {
  const notScored = { tooRecent: 0, noBaseline: 0, noOutcome: 0 };
  const bull: Tally = { scored: 0, hits: 0, rightWay: 0 };
  const bear: Tally = { scored: 0, hits: 0, rightWay: 0 };
  const byChannel = new Map<string, Tally & { title: string }>();
  const calls: ScoredCall[] = [];
  let clearMisses = 0;
  let flat = 0;
  let baseSum = 0;
  let baseN = 0;

  for (const s of signals) {
    const o = scoreSignal(s, historyByItem.get(s.itemId) ?? [], p);
    if (o.status === "too_recent") notScored.tooRecent += 1;
    else if (o.status === "no_baseline") notScored.noBaseline += 1;
    else if (o.status === "no_outcome") notScored.noOutcome += 1;
    else {
      const t = s.direction === "bullish" ? bull : bear;
      t.scored += 1;
      if (o.hit) t.hits += 1;
      if (o.rightWay) t.rightWay += 1;
      if (o.clearMiss) clearMisses += 1;
      if (!o.hit && !o.clearMiss) flat += 1;

      const c = byChannel.get(s.channelId) ?? {
        title: s.channelTitle,
        scored: 0,
        hits: 0,
        rightWay: 0,
      };
      c.scored += 1;
      if (o.hit) c.hits += 1;
      if (o.rightWay) c.rightWay += 1;
      byChannel.set(s.channelId, c);

      calls.push({
        signal: s,
        movePct: o.movePct,
        hit: o.hit,
        rightWay: o.rightWay,
      });

      // What a random pick would have scored over the same window.
      const target = new Date(s.at.getTime() + p.horizonDays * DAY_MS);
      let n = 0;
      let good = 0;
      for (const [itemId, h] of historyByItem) {
        if (itemId === s.itemId) continue;
        const m = moveBetween(h, s.at, target, p.maxGapDays);
        if (m.kind !== "ok") continue;
        n += 1;
        const signed = s.direction === "bullish" ? m.pct : -m.pct;
        if (signed >= p.threshold) good += 1;
      }
      if (n > 0) {
        baseSum += good / n;
        baseN += 1;
      }
    }
  }

  const scored = bull.scored + bear.scored;
  const hits = bull.hits + bear.hits;
  const rightWay = bull.rightWay + bear.rightWay;

  const creators: CreatorTrack[] = Array.from(byChannel, ([channelId, c]) => ({
    channelId,
    channelTitle: c.title,
    scored: c.scored,
    hits: c.hits,
    rightWay: c.rightWay,
    strictRate: rate(c.hits, c.scored),
    thin: c.scored < MIN_CREATOR_CALLS,
  })).sort(
    (a, b) =>
      Number(a.thin) - Number(b.thin) ||
      (b.strictRate ?? 0) - (a.strictRate ?? 0) ||
      b.scored - a.scored ||
      a.channelTitle.localeCompare(b.channelTitle),
  );

  return {
    params: {
      horizonDays: p.horizonDays,
      threshold: p.threshold,
      maxGapDays: p.maxGapDays,
    },
    total: signals.length,
    scored,
    strictRate: rate(hits, scored),
    directionRate: rate(rightWay, scored),
    hits,
    rightWay,
    clearMisses,
    flat,
    notScored,
    baseRate: baseN > 0 ? baseSum / baseN : null,
    bullish: { ...bull, strictRate: rate(bull.hits, bull.scored) },
    bearish: { ...bear, strictRate: rate(bear.hits, bear.scored) },
    creators,
    recent: calls
      .sort((a, b) => b.signal.at.getTime() - a.signal.at.getTime())
      .slice(0, recentLimit),
  };
}
