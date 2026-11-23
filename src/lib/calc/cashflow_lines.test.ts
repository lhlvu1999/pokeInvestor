import { describe, expect, it } from "vitest";
import { groupByMonthCurrency, replayItemEvents } from "./cashflow";
import { computeCashflowLines, type CashflowLineTx } from "./cashflow_lines";

const t = (iso: string) => new Date(iso);

const tx = (o: {
  type: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  occurredAt: Date;
  currency?: string;
  lotId?: string | null;
  shippingCents?: number | null;
}): CashflowLineTx => ({
  currency: "USD",
  lotId: null,
  shippingCents: null,
  ...o,
});

const names = new Map([
  ["a", "Alpha Box"],
  ["b", "Beta Tin"],
]);

describe("computeCashflowLines", () => {
  it("returns nothing for no transactions", () => {
    expect(computeCashflowLines(new Map(), names)).toEqual([]);
    expect(computeCashflowLines(new Map([["a", []]]), names)).toEqual([]);
  });

  it("keeps item, unit counts and tx counts per month", () => {
    const lines = computeCashflowLines(
      new Map([
        [
          "a",
          [
            tx({
              type: "buy",
              quantity: 2,
              finalValueCents: 20_000,
              shippingCents: 500,
              occurredAt: t("2026-01-10T00:00:00Z"),
            }),
            tx({
              type: "buy",
              quantity: 1,
              finalValueCents: 11_000,
              occurredAt: t("2026-01-20T00:00:00Z"),
            }),
            tx({
              type: "sell",
              quantity: 2,
              finalValueCents: 30_000,
              occurredAt: t("2026-02-03T00:00:00Z"),
            }),
          ],
        ],
      ]),
      names,
    );

    expect(lines).toHaveLength(2);
    const [jan, feb] = lines;
    expect(jan).toMatchObject({
      month: "2026-01",
      itemId: "a",
      itemName: "Alpha Box",
      spend: 31_000,
      revenue: 0,
      shipping: 500,
      buys: 2,
      sells: 0,
      unitsBought: 3,
      unitsSold: 0,
    });
    expect(feb).toMatchObject({
      month: "2026-02",
      revenue: 30_000,
      buys: 0,
      sells: 1,
      unitsSold: 2,
      // FIFO: sold 2 units out of the first (2 @ 20_000) buy → cost 20_000.
      realized: 10_000,
    });
  });

  it("separates items and falls back to a placeholder name", () => {
    const lines = computeCashflowLines(
      new Map([
        [
          "b",
          [
            tx({
              type: "buy",
              quantity: 1,
              finalValueCents: 5_000,
              occurredAt: t("2026-01-05T00:00:00Z"),
            }),
          ],
        ],
        [
          "zzz",
          [
            tx({
              type: "buy",
              quantity: 1,
              finalValueCents: 7_000,
              occurredAt: t("2026-01-06T00:00:00Z"),
            }),
          ],
        ],
      ]),
      names,
    );
    expect(lines.map((l) => l.itemName).sort()).toEqual([
      "(unknown item)",
      "Beta Tin",
    ]);
  });

  it("does not merge currencies for the same item and month", () => {
    const lines = computeCashflowLines(
      new Map([
        [
          "a",
          [
            tx({
              type: "buy",
              quantity: 1,
              finalValueCents: 1_000,
              currency: "USD",
              occurredAt: t("2026-03-01T00:00:00Z"),
            }),
            tx({
              type: "buy",
              quantity: 1,
              finalValueCents: 2_000,
              currency: "EUR",
              occurredAt: t("2026-03-02T00:00:00Z"),
            }),
          ],
        ],
      ]),
      names,
    );
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.currency).sort()).toEqual(["EUR", "USD"]);
  });

  it("matches the (month, currency) rollup used elsewhere", () => {
    const itemA = [
      tx({
        type: "buy",
        quantity: 3,
        finalValueCents: 30_000,
        shippingCents: 900,
        occurredAt: t("2026-01-15T09:00:00Z"),
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 15_000,
        occurredAt: t("2026-02-15T09:00:00Z"),
      }),
      tx({
        type: "sell",
        quantity: 2,
        finalValueCents: 22_000,
        occurredAt: t("2026-02-20T09:00:00Z"),
      }),
    ];
    const itemB = [
      tx({
        type: "buy",
        quantity: 1,
        finalValueCents: 8_000,
        occurredAt: t("2026-02-01T09:00:00Z"),
      }),
      tx({
        type: "sell",
        quantity: 1,
        finalValueCents: 6_000,
        occurredAt: t("2026-03-01T09:00:00Z"),
      }),
    ];

    const rollup = groupByMonthCurrency([
      ...replayItemEvents(itemA),
      ...replayItemEvents(itemB),
    ]);
    const lines = computeCashflowLines(
      new Map([
        ["a", itemA],
        ["b", itemB],
      ]),
      names,
    );

    for (const r of rollup) {
      const mine = lines.filter(
        (l) => l.month === r.month && l.currency === r.currency,
      );
      const sum = (k: "spend" | "revenue" | "realized" | "shipping") =>
        mine.reduce((acc, l) => acc + l[k], 0);
      expect(sum("spend")).toBe(r.spend);
      expect(sum("revenue")).toBe(r.revenue);
      expect(sum("realized")).toBe(r.realized);
      expect(sum("shipping")).toBe(r.shipping);
    }
  });

  it("attributes unsorted input correctly", () => {
    const lines = computeCashflowLines(
      new Map([
        [
          "a",
          [
            // Deliberately out of order: the sell comes first in the array.
            tx({
              type: "sell",
              quantity: 1,
              finalValueCents: 15_000,
              occurredAt: t("2026-02-15T00:00:00Z"),
            }),
            tx({
              type: "buy",
              quantity: 1,
              finalValueCents: 10_000,
              occurredAt: t("2026-01-15T00:00:00Z"),
            }),
          ],
        ],
      ]),
      names,
    );
    expect(lines[0]).toMatchObject({ month: "2026-01", buys: 1, sells: 0 });
    expect(lines[1]).toMatchObject({
      month: "2026-02",
      sells: 1,
      unitsSold: 1,
      realized: 5_000,
    });
  });
});
