import { describe, expect, it } from "vitest";
import {
  buildAttentionItems,
  OVERDUE_DELIVERY_DAYS,
  STALE_PRICE_HOURS,
  type AttentionInput,
} from "./attention";
import { formatAge, ageInDays, ageInHours } from "./relative_time";
import { pickMovers } from "./movers";

const NOW = new Date("2026-11-22T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const base = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  now: NOW,
  formatMoney: (m) => `$${m}`,
  pending: null,
  unpriced: { count: 0, costDisplay: 0 },
  latestPriceAt: hoursAgo(1),
  sell: { count: 0, names: [] },
  watchlist: { count: 0, names: [] },
  ...over,
});

describe("buildAttentionItems — all clear", () => {
  it("returns nothing when nothing needs attention", () => {
    expect(buildAttentionItems(base())).toEqual([]);
  });

  it("ignores a pending summary with zero units", () => {
    const out = buildAttentionItems(
      base({
        pending: { units: 0, itemCount: 0, costDisplay: 0, oldestAt: null },
      }),
    );
    expect(out).toEqual([]);
  });
});

describe("buildAttentionItems — on the way", () => {
  it("summarises units, items, money and age", () => {
    const [row] = buildAttentionItems(
      base({
        pending: {
          units: 10,
          itemCount: 3,
          costDisplay: 343,
          oldestAt: daysAgo(9),
        },
      }),
    );
    expect(row.key).toBe("on-the-way");
    expect(row.title).toBe("10 units on the way");
    expect(row.detail).toBe("3 items · $343 paid · oldest bought 9d ago");
    expect(row.href).toBe("/items?status=on-the-way");
  });

  it("uses singular wording for one unit of one item", () => {
    const [row] = buildAttentionItems(
      base({
        pending: {
          units: 1,
          itemCount: 1,
          costDisplay: 5,
          oldestAt: daysAgo(1),
        },
      }),
    );
    expect(row.title).toBe("1 unit on the way");
    expect(row.detail).toContain("1 item ");
  });

  it("is informational while the order is recent", () => {
    const [row] = buildAttentionItems(
      base({
        pending: {
          units: 2,
          itemCount: 1,
          costDisplay: 1,
          oldestAt: daysAgo(OVERDUE_DELIVERY_DAYS - 1),
        },
      }),
    );
    expect(row.tone).toBe("info");
  });

  it("escalates to a warning once an order is overdue", () => {
    const [row] = buildAttentionItems(
      base({
        pending: {
          units: 2,
          itemCount: 1,
          costDisplay: 1,
          oldestAt: daysAgo(OVERDUE_DELIVERY_DAYS),
        },
      }),
    );
    expect(row.tone).toBe("warn");
  });

  it("omits the age clause when the oldest date is unknown", () => {
    const [row] = buildAttentionItems(
      base({
        pending: { units: 2, itemCount: 1, costDisplay: 1, oldestAt: null },
      }),
    );
    expect(row.detail).not.toContain("oldest");
  });
});

describe("buildAttentionItems — prices", () => {
  it("flags stale prices at the threshold, not before", () => {
    const fresh = buildAttentionItems(
      base({ latestPriceAt: hoursAgo(STALE_PRICE_HOURS - 1) }),
    );
    expect(fresh.find((i) => i.key === "stale-prices")).toBeUndefined();

    const stale = buildAttentionItems(
      base({ latestPriceAt: hoursAgo(STALE_PRICE_HOURS) }),
    );
    const row = stale.find((i) => i.key === "stale-prices")!;
    expect(row.tone).toBe("warn");
    expect(row.title).toBe("Prices last updated 2d ago");
  });

  it("does not report stale prices when there are no prices at all", () => {
    // "Never priced" is the unpriced row's job; calling it stale would
    // describe a snapshot that doesn't exist.
    const out = buildAttentionItems(base({ latestPriceAt: null }));
    expect(out.find((i) => i.key === "stale-prices")).toBeUndefined();
  });

  it("reports unpriced holdings with the cost left out", () => {
    const [row] = buildAttentionItems(
      base({ unpriced: { count: 29, costDisplay: 108 } }),
    );
    expect(row.title).toBe("29 held items have no market price");
    expect(row.detail).toBe("$108 of cost isn't reflected in your value");
  });

  it("agrees in number for a single unpriced item", () => {
    const [row] = buildAttentionItems(
      base({ unpriced: { count: 1, costDisplay: 1 } }),
    );
    expect(row.title).toBe("1 held item has no market price");
  });
});

describe("buildAttentionItems — signals", () => {
  it("lists sell candidates and truncates long name lists", () => {
    const [row] = buildAttentionItems(
      base({ sell: { count: 5, names: ["A", "B", "C", "D", "E"] } }),
    );
    expect(row.title).toBe("5 items worth a look to sell");
    expect(row.detail).toBe("A, B +3 more");
  });

  it("does not claim 'more' when every name is shown", () => {
    const [row] = buildAttentionItems(
      base({ sell: { count: 2, names: ["A", "B"] } }),
    );
    expect(row.detail).toBe("A, B");
  });

  it("surfaces bullish watchlist items as the good-news row", () => {
    const [row] = buildAttentionItems(
      base({ watchlist: { count: 1, names: ["Journey Together ETB"] } }),
    );
    expect(row.tone).toBe("good");
    expect(row.title).toBe("1 watchlist item turning bullish");
    expect(row.href).toBe("/watchlist");
  });
});

describe("buildAttentionItems — ordering", () => {
  it("orders: on the way, stale, unpriced, sell, watchlist", () => {
    const out = buildAttentionItems(
      base({
        pending: {
          units: 1,
          itemCount: 1,
          costDisplay: 1,
          oldestAt: daysAgo(1),
        },
        latestPriceAt: hoursAgo(100),
        unpriced: { count: 1, costDisplay: 1 },
        sell: { count: 1, names: ["x"] },
        watchlist: { count: 1, names: ["y"] },
      }),
    );
    expect(out.map((i) => i.key)).toEqual([
      "on-the-way",
      "stale-prices",
      "unpriced",
      "sell",
      "watchlist",
    ]);
  });
});

describe("relative_time", () => {
  it.each([
    [0, "just now"],
    [30_000, "just now"],
    [5 * 60_000, "5m ago"],
    [3 * 3_600_000, "3h ago"],
    [2 * 86_400_000, "2d ago"],
    [29 * 86_400_000, "29d ago"],
    [65 * 86_400_000, "2mo ago"],
  ])("formats a %d ms gap as %s", (ms, expected) => {
    expect(formatAge(new Date(NOW.getTime() - ms), NOW)).toBe(expected);
  });

  it("clamps a future timestamp to zero rather than going negative", () => {
    const future = new Date(NOW.getTime() + 5 * 60_000);
    expect(formatAge(future, NOW)).toBe("just now");
    expect(ageInDays(future, NOW)).toBe(0);
    expect(ageInHours(future, NOW)).toBe(0);
  });

  it("measures fractional days and hours", () => {
    expect(ageInDays(hoursAgo(36), NOW)).toBeCloseTo(1.5, 5);
    expect(ageInHours(daysAgo(1), NOW)).toBeCloseTo(24, 5);
  });
});

describe("pickMovers", () => {
  const row = (name: string, changePct: number, spanDays: number) => ({
    name,
    change: { changePct, spanDays },
  });
  const rows = [
    row("up-big", 0.4, 30),
    row("up-small", 0.05, 30),
    row("down-big", -0.4, 30),
    row("down-small", -0.05, 30),
    { name: "no-history", change: null },
  ];

  it("splits into gainers (best first) and losers (worst first)", () => {
    const m = pickMovers(rows, { topN: 5, minSpanDays: 3 });
    expect(m.gainers.map((r) => r.name)).toEqual(["up-big", "up-small"]);
    expect(m.losers.map((r) => r.name)).toEqual(["down-big", "down-small"]);
  });

  it("drops rows without a computable change", () => {
    const m = pickMovers(rows, { topN: 5, minSpanDays: 3 });
    const all = [...m.gainers, ...m.losers].map((r) => r.name);
    expect(all).not.toContain("no-history");
  });

  it("caps each side at topN", () => {
    const m = pickMovers(rows, { topN: 1, minSpanDays: 3 });
    expect(m.gainers.map((r) => r.name)).toEqual(["up-big"]);
    expect(m.losers.map((r) => r.name)).toEqual(["down-big"]);
  });

  it("excludes changes measured over too short a span", () => {
    // A +400% 'move' across 50 minutes is a repricing artifact, not news.
    const noisy = [row("artifact", 4.0, 0.03), row("real", 0.1, 20)];
    const m = pickMovers(noisy, { topN: 5, minSpanDays: 3 });
    expect(m.gainers.map((r) => r.name)).toEqual(["real"]);
  });

  it("keeps a row exactly at the span threshold", () => {
    const m = pickMovers([row("edge", 0.1, 3)], { topN: 5, minSpanDays: 3 });
    expect(m.gainers).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.name);
    pickMovers(rows, { topN: 5, minSpanDays: 3 });
    expect(rows.map((r) => r.name)).toEqual(before);
  });

  it("returns empty lists for empty input", () => {
    expect(pickMovers([], { topN: 5, minSpanDays: 3 })).toEqual({
      gainers: [],
      losers: [],
    });
  });
});
