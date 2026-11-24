import { describe, expect, it } from "vitest";
import {
  computeReturn,
  FULL_YEAR_DAYS,
  MIN_DAYS,
  xirr,
  type ReturnEvent,
} from "./annualized";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const DAY = 86_400_000;

describe("xirr", () => {
  it("one out, one in, one year apart is the plain percentage", () => {
    const r = xirr([
      { at: d("2025-01-01"), amount: -100 },
      { at: d("2026-01-01"), amount: 110 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rate).toBeCloseTo(0.1, 6);
  });

  it("compounds over two years (121 after two years is 10%/yr)", () => {
    const r = xirr([
      { at: d("2024-01-01"), amount: -100 },
      { at: new Date(d("2024-01-01").getTime() + 730 * DAY), amount: 121 },
    ]);
    expect(r.ok && r.rate).toBeCloseTo(0.1, 6);
  });

  it("matches Excel's documented XIRR example (37.34%)", () => {
    const r = xirr([
      { at: d("2008-01-01"), amount: -10000 },
      { at: d("2008-03-01"), amount: 2750 },
      { at: d("2008-10-30"), amount: 4250 },
      { at: d("2009-02-15"), amount: 3250 },
      { at: d("2009-04-01"), amount: 2750 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rate).toBeCloseTo(0.373362535, 5);
  });

  it("is negative for a loss", () => {
    const r = xirr([
      { at: d("2025-01-01"), amount: -100 },
      { at: d("2026-01-01"), amount: 80 },
    ]);
    expect(r.ok && r.rate).toBeCloseTo(-0.2, 6);
  });

  it("is order-independent", () => {
    const flows = [
      { at: d("2026-01-01"), amount: 110 },
      { at: d("2025-01-01"), amount: -100 },
    ];
    const r = xirr(flows);
    expect(r.ok && r.rate).toBeCloseTo(0.1, 6);
  });

  it("weights WHEN money goes in: late money earning the same profit is a higher rate", () => {
    const early = xirr([
      { at: d("2025-01-01"), amount: -100 },
      { at: d("2026-01-01"), amount: 120 },
    ]);
    const late = xirr([
      { at: d("2025-07-01"), amount: -100 },
      { at: d("2026-01-01"), amount: 120 },
    ]);
    expect(early.ok && late.ok).toBe(true);
    if (early.ok && late.ok) expect(late.rate).toBeGreaterThan(early.rate);
  });

  it("has no answer when money only goes one way", () => {
    expect(
      xirr([
        { at: d("2025-01-01"), amount: -100 },
        { at: d("2026-01-01"), amount: -50 },
      ]),
    ).toEqual({ ok: false, reason: "no_root" });
  });

  it("has no answer when everything happens on one day", () => {
    expect(
      xirr([
        { at: d("2025-01-01"), amount: -100 },
        { at: d("2025-01-01"), amount: 120 },
      ]),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("needs at least two non-zero flows", () => {
    expect(xirr([{ at: d("2025-01-01"), amount: -100 }]).ok).toBe(false);
    expect(xirr([]).ok).toBe(false);
  });

  it("reports a total loss as no answer rather than a made-up rate", () => {
    // Everything gone: even −99.9%/yr cannot explain losing 100%.
    const r = xirr([
      { at: d("2025-01-01"), amount: -100 },
      { at: d("2026-01-01"), amount: 0.00001 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("flags several valid answers as ambiguous instead of picking one", () => {
    // −100, +230, −132: the classic two-root pattern (10% and 20%).
    const base = d("2025-01-01").getTime();
    const yr = 365 * DAY;
    const r = xirr([
      { at: new Date(base), amount: -100 },
      { at: new Date(base + yr), amount: 230 },
      { at: new Date(base + 2 * yr), amount: -132 },
    ]);
    expect(r).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("handles large minor-unit amounts (VND) without losing precision", () => {
    const r = xirr([
      { at: d("2025-01-01"), amount: -1_446_380_000 },
      { at: d("2026-01-01"), amount: 1_591_018_000 },
    ]);
    expect(r.ok && r.rate).toBeCloseTo(0.1, 6);
  });
});

describe("computeReturn", () => {
  const now = d("2026-06-01");

  it("returns none with no transactions", () => {
    expect(computeReturn([], 0, now)).toEqual({ status: "none" });
  });

  it("holds the figure back until MIN_DAYS of history", () => {
    const events: ReturnEvent[] = [
      { at: new Date(now.getTime() - 60 * DAY), type: "buy", amount: 100 },
    ];
    const r = computeReturn(events, 130, now);
    expect(r.status).toBe("too_early");
    if (r.status === "too_early") {
      expect(r.days).toBe(60);
      expect(r.daysToGo).toBe(MIN_DAYS - 60);
      expect(r.unlocksAt.getTime()).toBe(
        events[0].at.getTime() + MIN_DAYS * DAY,
      );
    }
  });

  it("unlocks exactly on day MIN_DAYS", () => {
    const at = new Date(now.getTime() - MIN_DAYS * DAY);
    expect(
      computeReturn([{ at, type: "buy", amount: 100 }], 110, now).status,
    ).toBe("ok");
    const one = new Date(now.getTime() - (MIN_DAYS - 1) * DAY);
    expect(
      computeReturn([{ at: one, type: "buy", amount: 100 }], 110, now).status,
    ).toBe("too_early");
  });

  it("flags figures under a year as extrapolated, and not after", () => {
    const short = computeReturn(
      [
        {
          at: new Date(now.getTime() - 200 * DAY),
          type: "buy",
          amount: 100,
        },
      ],
      110,
      now,
    );
    const long = computeReturn(
      [
        {
          at: new Date(now.getTime() - (FULL_YEAR_DAYS + 10) * DAY),
          type: "buy",
          amount: 100,
        },
      ],
      110,
      now,
    );
    expect(short.status === "ok" && short.extrapolated).toBe(true);
    expect(long.status === "ok" && long.extrapolated).toBe(false);
  });

  it("annualizes a simple hold: +10% over exactly one year", () => {
    const r = computeReturn(
      [{ at: new Date(now.getTime() - 365 * DAY), type: "buy", amount: 100 }],
      110,
      now,
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.annualized).toBeCloseTo(0.1, 6);
      expect(r.multiple).toBeCloseTo(1.1, 9);
      expect(r.profit).toBe(10);
    }
  });

  it("counts sale proceeds as money back when they arrive", () => {
    const events: ReturnEvent[] = [
      { at: new Date(now.getTime() - 400 * DAY), type: "buy", amount: 100 },
      { at: new Date(now.getTime() - 200 * DAY), type: "sell", amount: 70 },
    ];
    const r = computeReturn(events, 50, now);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.spent).toBe(100);
      expect(r.proceeds).toBe(70);
      expect(r.multiple).toBeCloseTo(1.2, 9);
      expect(r.profit).toBe(20);
      // Earlier cash back beats the same total arriving at the end.
      const allAtEnd = computeReturn(
        [events[0], { ...events[1], at: now }],
        50,
        now,
      );
      expect(allAtEnd.status === "ok" && allAtEnd.annualized).toBeLessThan(
        r.annualized,
      );
    }
  });

  it("keeps a gifted/lost unit as a ₫0 sale, so it drags the return down", () => {
    const base: ReturnEvent[] = [
      { at: new Date(now.getTime() - 400 * DAY), type: "buy", amount: 100 },
    ];
    const withLoss = computeReturn(
      [
        ...base,
        { at: new Date(now.getTime() - 100 * DAY), type: "sell", amount: 0 },
      ],
      120,
      now,
    );
    const without = computeReturn(base, 120, now);
    expect(withLoss.status === "ok" && without.status === "ok").toBe(true);
    if (withLoss.status === "ok" && without.status === "ok") {
      expect(withLoss.annualized).toBeCloseTo(without.annualized, 9);
      expect(withLoss.profit).toBe(without.profit);
    }
  });

  it("reports a loss as a negative rate", () => {
    const r = computeReturn(
      [{ at: new Date(now.getTime() - 365 * DAY), type: "buy", amount: 100 }],
      80,
      now,
    );
    expect(r.status === "ok" && r.annualized).toBeCloseTo(-0.2, 6);
  });

  it("is unavailable, not zero, when nothing was ever bought", () => {
    const r = computeReturn(
      [{ at: new Date(now.getTime() - 400 * DAY), type: "sell", amount: 50 }],
      0,
      now,
    );
    expect(r.status).toBe("unavailable");
  });

  it("is unavailable when the answer is ambiguous", () => {
    const t = (days: number) => new Date(now.getTime() - days * DAY);
    const r = computeReturn(
      [
        { at: t(730), type: "buy", amount: 100 },
        { at: t(365), type: "sell", amount: 230 },
        { at: t(0), type: "buy", amount: 132 },
      ],
      0,
      now,
    );
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") expect(r.reason).toBe("ambiguous");
  });
});
