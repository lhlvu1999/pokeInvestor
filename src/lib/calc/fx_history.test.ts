import { describe, expect, it } from "vitest";
import {
  convertOn,
  convertSale,
  crossRate,
  daysNeeded,
  parseRates,
  rateUrls,
  ratesFor,
  type DayRates,
} from "./fx_history";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const table = (o: Record<string, DayRates>) => new Map(Object.entries(o));

describe("parseRates", () => {
  const good = { date: "2026-01-26", usd: { vnd: 26211.3, eur: 0.84, jpy: 154, zzz: 5, gbp: -1, krw: "x" } };
  it("keeps supported currencies with sane rates, upper-cased, plus USD", () => {
    expect(parseRates(good, "2026-01-26")).toEqual({ USD: 1, VND: 26211.3, EUR: 0.84, JPY: 154 });
  });
  it("rejects a file for another day, or the wrong shape", () => {
    expect(parseRates(good, "2026-01-27")).toBeNull();
    expect(parseRates(null, "2026-01-26")).toBeNull();
    expect(parseRates({ date: "2026-01-26" }, "2026-01-26")).toBeNull();
    expect(parseRates({ date: "2026-01-26", usd: {} }, "2026-01-26")).toBeNull();
  });
});

describe("rateUrls", () => {
  it("names the day in both the CDN and its mirror", () => {
    const [a, b] = rateUrls("2026-01-26");
    expect(a).toContain("@2026-01-26/");
    expect(b).toContain("//2026-01-26.");
  });
});

describe("ratesFor", () => {
  const byDay = table({ "2026-01-20": { USD: 1, VND: 25000 }, "2026-01-26": { USD: 1, VND: 26000 } });
  it("prefers the exact day", () => {
    expect(ratesFor("2026-01-26", byDay)?.usedDay).toBe("2026-01-26");
  });
  it("falls back to the closest earlier day within a week", () => {
    expect(ratesFor("2026-01-24", byDay)?.usedDay).toBe("2026-01-20");
  });
  it("gives up when nothing recent exists", () => {
    expect(ratesFor("2026-01-10", byDay)).toBeNull();
    expect(ratesFor("2026-02-10", byDay)).toBeNull();
  });
  it("never looks forward", () => {
    expect(ratesFor("2026-01-19", byDay)).toBeNull();
  });
});

describe("crossRate", () => {
  const r = { USD: 1, VND: 25000, EUR: 0.8 };
  it("goes through the dollar", () => {
    expect(crossRate("USD", "VND", r)).toBe(25000);
    expect(crossRate("VND", "USD", r)).toBeCloseTo(1 / 25000, 12);
    expect(crossRate("EUR", "VND", r)).toBeCloseTo(25000 / 0.8, 6);
    expect(crossRate("VND", "VND", r)).toBe(1);
  });
  it("is null when a currency is unknown", () => {
    expect(crossRate("GBP", "VND", r)).toBeNull();
    expect(crossRate("VND", "GBP", r)).toBeNull();
  });
});

describe("convertOn", () => {
  const byDay = table({ "2026-01-26": { USD: 1, VND: 26000 } });
  it("converts at that day's rate and leaves same-currency alone", () => {
    expect(convertOn(1000, "USD", "VND", "2026-01-26", byDay)).toBe(260000); // $10.00
    expect(convertOn(5, "VND", "VND", "1999-01-01", byDay)).toBe(5);
  });
  it("is null with no rate for the day", () => {
    expect(convertOn(1000, "USD", "VND", "2026-03-01", byDay)).toBeNull();
  });
});

describe("convertSale", () => {
  // Dollar items shown in VND. The dollar fell between buying and selling.
  const byDay = table({
    "2026-01-10": { USD: 1, VND: 26000 },
    "2026-02-10": { USD: 1, VND: 25000 },
  });
  const sale = {
    soldOn: d("2026-02-10"),
    currency: "USD",
    proceeds: 10_000, // $100.00
    costLots: [{ buyDate: d("2026-01-10"), cost: 6_000 }], // $60.00
  };
  it("converts proceeds at the sale day and cost at the purchase day", () => {
    const r = convertSale(sale, "VND", byDay, null)!;
    expect(r.proceeds).toBe(100 * 25000);
    expect(r.cost).toBe(60 * 26000);
    expect(r.realized).toBe(2_500_000 - 1_560_000);
    expect(r.approx).toBe(false);
  });
  it("differs from converting everything at the sale day's rate", () => {
    const r = convertSale(sale, "VND", byDay, null)!;
    expect(r.realized).not.toBe((10_000 - 6_000) / 100 * 25000);
  });
  it("converts each purchase at its own day", () => {
    const two = {
      ...sale,
      costLots: [
        { buyDate: d("2026-01-10"), cost: 3_000 },
        { buyDate: d("2026-02-10"), cost: 3_000 },
      ],
    };
    expect(convertSale(two, "VND", byDay, null)!.cost).toBe(30 * 26000 + 30 * 25000);
  });
  it("falls back to today's rate for a day with none, and says so", () => {
    const old = { ...sale, costLots: [{ buyDate: d("2025-06-01"), cost: 6_000 }] };
    const r = convertSale(old, "VND", byDay, (m) => Math.round((m / 100) * 24000))!;
    expect(r.approx).toBe(true);
    expect(r.cost).toBe(60 * 24000);
    expect(r.proceeds).toBe(100 * 25000);
  });
  it("has no answer when even today's rate is missing", () => {
    expect(convertSale({ ...sale, soldOn: d("2030-01-01") }, "VND", byDay, null)).toBeNull();
    expect(convertSale({ ...sale, soldOn: d("2030-01-01") }, "VND", byDay, () => null)).toBeNull();
  });
  it("a sale with nothing brought in and a cost is a loss at the purchase-day rate", () => {
    const gift = { ...sale, proceeds: 0 };
    const r = convertSale(gift, "VND", byDay, null)!;
    expect(r.realized).toBe(-60 * 26000);
  });
});

describe("daysNeeded", () => {
  it("lists every sale day and purchase day once, sorted", () => {
    const days = daysNeeded([
      { soldOn: d("2026-02-10"), currency: "USD", proceeds: 1, costLots: [{ buyDate: d("2026-01-10"), cost: 1 }] },
      { soldOn: d("2026-02-10"), currency: "USD", proceeds: 1, costLots: [{ buyDate: d("2026-01-10"), cost: 1 }, { buyDate: d("2025-12-01"), cost: 1 }] },
    ]);
    expect(days).toEqual(["2025-12-01", "2026-01-10", "2026-02-10"]);
  });
});
