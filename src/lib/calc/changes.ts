/**
 * "What changed": the pure maths behind the dashboard's change panel.
 *
 * Everything is measured over a trailing window (24 hours or a week) ending
 * now, and kept honest about what the data can and cannot say:
 *
 * - A price only exists when someone refreshed it, so "the price at the
 *   start of the window" is the last snapshot at or before it. An item with
 *   no snapshot INSIDE the window has not moved as far as we know — it is
 *   counted as "not refreshed", never as flat.
 * - The value change is what you hold NOW, repriced: quantity × (price now −
 *   price then). Buying or selling is shown as activity, not as a change in
 *   value, so a big purchase can't masquerade as a gain.
 */

import { isSale } from "./exit_reason";
import {
  latestPrice,
  priceAsOf,
  sortAscending,
  type PricePoint,
} from "./price_history";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type ChangeWindow = "day" | "week";

export const CHANGE_WINDOWS: {
  value: ChangeWindow;
  label: string;
  ms: number;
}[] = [
  { value: "day", label: "24h", ms: DAY_MS },
  { value: "week", label: "Week", ms: 7 * DAY_MS },
];

export function isChangeWindow(v: unknown): v is ChangeWindow {
  return v === "day" || v === "week";
}

export function windowBounds(
  window: ChangeWindow,
  now: Date,
): { start: Date; end: Date } {
  const ms = CHANGE_WINDOWS.find((w) => w.value === window)!.ms;
  return { start: new Date(now.getTime() - ms), end: now };
}

/* ------------------------------------------------------------------ */
/* One item's price move                                               */
/* ------------------------------------------------------------------ */

export type PriceMove = {
  fromCents: number;
  toCents: number;
  fromAt: Date;
  toAt: Date;
  /** Fraction: 0.12 = +12%. */
  changePct: number;
};

export type MoveResult =
  | { kind: "moved"; move: PriceMove }
  /** Priced, but no snapshot was taken inside the window. */
  | { kind: "no_update" }
  /** Refreshed in the window, but nothing before it to compare against. */
  | { kind: "no_baseline" }
  /** Never priced. */
  | { kind: "empty" };

export function priceMoveInWindow(
  history: ReadonlyArray<PricePoint>,
  start: Date,
  end: Date,
): MoveResult {
  const upToEnd = history.filter((p) => p.fetchedAt.getTime() <= end.getTime());
  const to = latestPrice(upToEnd);
  if (!to) return { kind: "empty" };
  if (to.fetchedAt.getTime() <= start.getTime()) return { kind: "no_update" };

  const from = priceAsOf(upToEnd, start);
  if (!from || from.priceCents <= 0) return { kind: "no_baseline" };

  return {
    kind: "moved",
    move: {
      fromCents: from.priceCents,
      toCents: to.priceCents,
      fromAt: from.fetchedAt,
      toAt: to.fetchedAt,
      changePct: (to.priceCents - from.priceCents) / from.priceCents,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Value change across holdings                                        */
/* ------------------------------------------------------------------ */

export type HeldInput = {
  itemId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  /** Currency of the item's prices and amounts. */
  currency: string;
  history: ReadonlyArray<PricePoint>;
};

export type Mover = {
  itemId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  changePct: number;
  /** Money effect on what you hold now, in display currency. */
  impact: number;
  fromUnit: number;
  toUnit: number;
};

export type ValueChange = {
  /** Sum of the movers' impact, display currency. */
  impact: number;
  moved: number;
  /** Priced, but not refreshed inside the window. */
  notRefreshed: number;
  /** Refreshed inside the window but with nothing earlier to compare. */
  noBaseline: number;
  /** In stock with no price at all. */
  unpriced: number;
  movers: Mover[];
};

/**
 * `toDisplay` converts a minor-unit amount from `currency` to the display
 * currency, or returns null when no rate is available. The item is then left
 * out rather than shown with a wrong number.
 */
export function summarizeValueChange(
  held: ReadonlyArray<HeldInput>,
  start: Date,
  end: Date,
  toDisplay: (minor: number, currency: string) => number | null,
): ValueChange {
  const out: ValueChange = {
    impact: 0,
    moved: 0,
    notRefreshed: 0,
    noBaseline: 0,
    unpriced: 0,
    movers: [],
  };
  for (const h of held) {
    if (h.quantity <= 0) continue;
    const r = priceMoveInWindow(h.history, start, end);
    if (r.kind === "empty") out.unpriced += 1;
    else if (r.kind === "no_update") out.notRefreshed += 1;
    else if (r.kind === "no_baseline") out.noBaseline += 1;
    else {
      const m = r.move;
      const impact = toDisplay(
        h.quantity * (m.toCents - m.fromCents),
        h.currency,
      );
      if (impact == null) continue;
      out.moved += 1;
      out.impact += impact;
      out.movers.push({
        itemId: h.itemId,
        name: h.name,
        imageUrl: h.imageUrl,
        quantity: h.quantity,
        changePct: m.changePct,
        impact,
        fromUnit: m.fromCents,
        toUnit: m.toCents,
      });
    }
  }
  return out;
}

/** Biggest money effect first, so what mattered leads the list. */
export function pickMoversByImpact(
  movers: ReadonlyArray<Mover>,
  topN: number,
): { gainers: Mover[]; losers: Mover[] } {
  const gainers = movers
    .filter((m) => m.impact > 0)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, topN);
  const losers = movers
    .filter((m) => m.impact < 0)
    .sort((a, b) => a.impact - b.impact)
    .slice(0, topN);
  return { gainers, losers };
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export type ActivityTx = {
  id: string;
  itemId: string;
  name: string;
  type: "buy" | "sell";
  quantity: number;
  /** Display currency. */
  total: number;
  occurredAt: Date;
  exitReason: string | null;
};

export type Activity = {
  buys: { count: number; units: number; total: number };
  sells: { count: number; units: number; total: number };
  /** Gifted / lost / opened: units that left without a sale. */
  exits: { count: number; units: number };
  recent: ActivityTx[];
};

export function summarizeActivity(
  txs: ReadonlyArray<ActivityTx>,
  start: Date,
  end: Date,
  recentLimit = 8,
): Activity {
  const a: Activity = {
    buys: { count: 0, units: 0, total: 0 },
    sells: { count: 0, units: 0, total: 0 },
    exits: { count: 0, units: 0 },
    recent: [],
  };
  const inWindow = txs.filter((t) => {
    const ts = t.occurredAt.getTime();
    return ts > start.getTime() && ts <= end.getTime();
  });
  for (const t of inWindow) {
    if (t.type === "buy") {
      a.buys.count += 1;
      a.buys.units += t.quantity;
      a.buys.total += t.total;
    } else if (isSale(t.exitReason)) {
      a.sells.count += 1;
      a.sells.units += t.quantity;
      a.sells.total += t.total;
    } else {
      a.exits.count += 1;
      a.exits.units += t.quantity;
    }
  }
  a.recent = [...inWindow]
    .sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime())
    .slice(0, recentLimit);
  return a;
}

/* ------------------------------------------------------------------ */
/* Watchlist targets                                                   */
/* ------------------------------------------------------------------ */

export type WatchInput = {
  name: string;
  itemId: string | null;
  targetCents: number;
  /** Currency of the target. Compared only against prices in the same one. */
  currency: string;
  /** Price history of the linked item, in `priceCurrency`. */
  history: ReadonlyArray<PricePoint>;
  priceCurrency: string | null;
};

export type WatchHit = {
  name: string;
  itemId: string | null;
  priceCents: number;
  targetCents: number;
  currency: string;
  /** Crossed below the target during the window (vs already below). */
  isNew: boolean;
};

/**
 * Entries whose linked item is at or under the buy target now, newly
 * crossed ones first. "Newly" needs a price from before the window that was
 * still above target — otherwise we can't claim it just happened.
 */
export function watchHits(
  entries: ReadonlyArray<WatchInput>,
  start: Date,
  end: Date,
): WatchHit[] {
  const hits: WatchHit[] = [];
  for (const e of entries) {
    if (e.targetCents <= 0 || e.history.length === 0) continue;
    if (e.priceCurrency !== e.currency) continue;
    const sorted = sortAscending(
      e.history.filter((p) => p.fetchedAt.getTime() <= end.getTime()),
    );
    const now = sorted[sorted.length - 1];
    if (!now || now.priceCents > e.targetCents) continue;
    const before = priceAsOf(sorted, start);
    hits.push({
      name: e.name,
      itemId: e.itemId,
      priceCents: now.priceCents,
      targetCents: e.targetCents,
      currency: e.currency,
      isNew: before != null && before.priceCents > e.targetCents,
    });
  }
  return hits.sort((a, b) => Number(b.isNew) - Number(a.isNew));
}
