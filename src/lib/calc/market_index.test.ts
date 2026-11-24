import { describe, expect, it } from "vitest";
import {
  blendChanges,
  chainIndex,
  indexChange,
  maxDrawdown,
  rebaseTogether,
  spanDays,
  type DailyChange,
} from "./market_index";

const c = (day: string, change: number | null, n = 20): DailyChange => ({
  day,
  change,
  n,
});

describe("chainIndex", () => {
  it("starts at 100 the day before the first change and links changes", () => {
    const out = chainIndex([
      c("2024-03-01", 0.1),
      c("2024-03-02", -0.1),
      c("2024-03-03", 0.5),
    ]);
    expect(out.map((p) => p.day)).toEqual([
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
      "2024-03-03",
    ]);
    expect(out[0].value).toBe(100);
    expect(out[1].value).toBeCloseTo(110, 10);
    expect(out[2].value).toBeCloseTo(99, 10); // 110 × 0.9
    expect(out[3].value).toBeCloseTo(148.5, 10); // 99 × 1.5
  });

  it("sorts unsorted input", () => {
    const out = chainIndex([c("2024-03-02", 0.1), c("2024-03-01", 0.1)]);
    expect(out.map((p) => p.day)).toEqual([
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
    ]);
    expect(out[2].value).toBeCloseTo(121, 10);
  });

  it("skips days that are missing, thin or impossible, without guessing", () => {
    const out = chainIndex([
      c("2024-03-01", 0.1),
      c("2024-03-02", null),
      c("2024-03-03", 0.2, 3), // too few constituents
      c("2024-03-04", Number.NaN),
      c("2024-03-05", -1), // can't lose everything
      c("2024-03-06", 0.1),
    ]);
    expect(out.map((p) => p.day)).toEqual([
      "2024-02-29",
      "2024-03-01",
      "2024-03-06",
    ]);
    expect(out[2].value).toBeCloseTo(121, 10);
  });

  it("returns nothing when no day is usable", () => {
    expect(chainIndex([])).toEqual([]);
    expect(chainIndex([c("2024-03-01", 0.1, 2)])).toEqual([]);
  });

  it("respects a custom minimum", () => {
    expect(chainIndex([c("2024-03-01", 0.1, 2)], 2)).toHaveLength(2);
  });

  it("crosses a leap day correctly", () => {
    const out = chainIndex([c("2024-03-01", 0)]);
    expect(out[0].day).toBe("2024-02-29");
  });
});

describe("indexChange", () => {
  const series = chainIndex(
    Array.from({ length: 40 }, (_, i) =>
      c(new Date(Date.UTC(2024, 2, 1 + i)).toISOString().slice(0, 10), 0.01),
    ),
  );
  it("measures over a window the series covers", () => {
    expect(indexChange(series, 30)).toBeCloseTo(1.01 ** 30 - 1, 6);
  });
  it("is null when the series is too short", () => {
    expect(indexChange(series, 365)).toBeNull();
  });
});

describe("maxDrawdown", () => {
  it("is the biggest fall from a high", () => {
    const s = [
      { day: "2024-01-01", value: 100 },
      { day: "2024-01-02", value: 200 },
      { day: "2024-01-03", value: 120 },
      { day: "2024-01-04", value: 150 },
    ];
    expect(maxDrawdown(s)).toBeCloseTo(0.4, 10);
  });
  it("is 0 for a rising series or none", () => {
    expect(maxDrawdown([])).toBe(0);
    expect(
      maxDrawdown([
        { day: "2024-01-01", value: 1 },
        { day: "2024-01-02", value: 2 },
      ]),
    ).toBe(0);
  });
});

describe("spanDays", () => {
  it("counts days between first and last", () => {
    expect(
      spanDays([
        { day: "2024-01-01", value: 1 },
        { day: "2024-01-31", value: 1 },
      ]),
    ).toBe(30);
    expect(spanDays([])).toBe(0);
  });
});

describe("blendChanges", () => {
  it("weights groups by how many things each was measured over", () => {
    // 30 things up 10%, 10 things flat → ln-weighted: 0.75·ln1.1.
    const out = blendChanges([
      [c("2024-03-01", 0.1, 30)],
      [c("2024-03-01", 0, 10)],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].n).toBe(40);
    expect(out[0].change).toBeCloseTo(Math.exp(0.75 * Math.log(1.1)) - 1, 12);
  });

  it("always lands between its parts", () => {
    const [b] = blendChanges([
      [c("2024-03-01", 0.2, 5)],
      [c("2024-03-01", -0.05, 50)],
      [c("2024-03-01", 0.01, 12)],
    ]);
    expect(b.change!).toBeGreaterThan(-0.05);
    expect(b.change!).toBeLessThan(0.2);
  });

  it("uses only the groups that have a usable change that day", () => {
    const out = blendChanges([
      [c("2024-03-01", 0.1, 20), c("2024-03-02", null, 20)],
      [c("2024-03-01", Number.NaN, 20), c("2024-03-02", 0.04, 20)],
    ]);
    expect(out.map((d) => [d.day, d.n])).toEqual([
      ["2024-03-01", 20],
      ["2024-03-02", 20],
    ]);
    expect(out[0].change).toBeCloseTo(0.1, 12);
    expect(out[1].change).toBeCloseTo(0.04, 12);
  });

  it("is empty with nothing usable and sorted by day otherwise", () => {
    expect(blendChanges([])).toEqual([]);
    expect(blendChanges([[c("2024-03-01", null)]])).toEqual([]);
    const out = blendChanges([
      [c("2024-03-02", 0.1, 10)],
      [c("2024-03-01", 0.1, 10)],
    ]);
    expect(out.map((d) => d.day)).toEqual(["2024-03-01", "2024-03-02"]);
  });
});

describe("rebaseTogether", () => {
  const a = [
    { day: "2024-01-01", value: 100 },
    { day: "2024-01-02", value: 110 },
    { day: "2024-01-03", value: 121 },
    { day: "2024-01-04", value: 133.1 },
  ];
  const b = [
    { day: "2024-01-03", value: 100 },
    { day: "2024-01-04", value: 90 },
  ];

  it("starts every series at 100 on the latest first day", () => {
    const r = rebaseTogether([a, b])!;
    expect(r.day).toBe("2024-01-03");
    expect(r.series[0].map((p) => p.day)).toEqual(["2024-01-03", "2024-01-04"]);
    expect(r.series[0][0].value).toBeCloseTo(100, 10);
    expect(r.series[0][1].value).toBeCloseTo(110, 10); // 133.1 / 121
    expect(r.series[1][1].value).toBeCloseTo(90, 10);
  });

  it("leaves a single series alone", () => {
    const r = rebaseTogether([a])!;
    expect(r.day).toBe("2024-01-01");
    expect(r.series[0].map((p) => p.day)).toEqual(a.map((p) => p.day));
    r.series[0].forEach((p, i) => expect(p.value).toBeCloseTo(a[i].value, 10));
  });

  it("ignores empty series and returns null when all are empty", () => {
    const r = rebaseTogether([a, []])!;
    expect(r.series[1]).toEqual([]);
    expect(r.series[0]).toHaveLength(a.length);
    expect(rebaseTogether([])).toBeNull();
    expect(rebaseTogether([[]])).toBeNull();
  });
});
