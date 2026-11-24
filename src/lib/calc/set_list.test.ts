import { describe, expect, it } from "vitest";
import {
  BULK_DATE_THRESHOLD,
  comparableChange,
  bulkReleaseDates,
  changeLabel,
  DEFAULT_SET_QUERY,
  filterAndSortSets,
  releaseLabel,
  type SetListLike,
  type SetListQuery,
} from "./set_list";

let id = 0;
const set = (over: Partial<SetListLike> = {}): SetListLike => ({
  groupId: ++id,
  name: `Set ${id}`,
  abbreviation: null,
  language: "en",
  publishedOn: "2025-01-01",
  pricedCount: 10,
  totalCents: 1000,
  top20Cents: 500,
  changePct: null,
  yourItems: 0,
  ...over,
});
const q = (over: Partial<SetListQuery> = {}): SetListQuery => ({
  ...DEFAULT_SET_QUERY,
  ...over,
});
const names = (rows: SetListLike[]) => rows.map((r) => r.name);

describe("filterAndSortSets: filtering", () => {
  const rows = [
    set({ name: "Black Bolt", abbreviation: "SV11B", language: "ja" }),
    set({ name: "Surging Sparks", abbreviation: "SSP" }),
    set({ name: "Empty Old Set", pricedCount: 0 }),
    set({ name: "Mine", yourItems: 2 }),
  ];

  it("filters by language", () => {
    expect(names(filterAndSortSets(rows, q({ language: "ja" })))).toEqual([
      "Black Bolt",
    ]);
    expect(filterAndSortSets(rows, q({ language: "en" }))).toHaveLength(2);
    expect(filterAndSortSets(rows, q({ language: "all" }))).toHaveLength(3);
  });

  it("hides sets with no priced cards by default, and shows them on request", () => {
    expect(names(filterAndSortSets(rows, q()))).not.toContain("Empty Old Set");
    expect(names(filterAndSortSets(rows, q({ onlyPriced: false })))).toContain(
      "Empty Old Set",
    );
  });

  it("searches names and abbreviations without regard to case", () => {
    expect(names(filterAndSortSets(rows, q({ text: "SPARK" })))).toEqual([
      "Surging Sparks",
    ]);
    expect(names(filterAndSortSets(rows, q({ text: "sv11b" })))).toEqual([
      "Black Bolt",
    ]);
    expect(filterAndSortSets(rows, q({ text: "  " }))).toHaveLength(3);
    expect(filterAndSortSets(rows, q({ text: "zzz" }))).toEqual([]);
  });

  it("can show only sets you hold something from", () => {
    expect(names(filterAndSortSets(rows, q({ onlyMine: true })))).toEqual([
      "Mine",
    ]);
  });

  it("combines filters", () => {
    expect(
      filterAndSortSets(rows, q({ language: "ja", text: "spark" })),
    ).toEqual([]);
  });

  it("does not modify the input array", () => {
    const copy = [...rows];
    filterAndSortSets(rows, q({ sort: "name" }));
    expect(rows).toEqual(copy);
  });
});

describe("filterAndSortSets: sorting", () => {
  it("newest first, undated sets last", () => {
    const rows = [
      set({ name: "Old", publishedOn: "2020-05-01" }),
      set({ name: "Undated", publishedOn: null }),
      set({ name: "New", publishedOn: "2026-09-01" }),
    ];
    expect(names(filterAndSortSets(rows, q({ sort: "newest" })))).toEqual([
      "New",
      "Old",
      "Undated",
    ]);
  });

  it("by value, biggest first", () => {
    const rows = [
      set({ name: "A", totalCents: 5 }),
      set({ name: "B", totalCents: 50 }),
    ];
    expect(names(filterAndSortSets(rows, q({ sort: "value" })))).toEqual([
      "B",
      "A",
    ]);
    expect(names(filterAndSortSets(rows, q({ sort: "top20" })))).toEqual(
      ["A", "B"].sort(),
    ); // equal top20: by name
  });

  it("by change, with sets that have no history last whichever way", () => {
    const rows = [
      set({ name: "None", changePct: null }),
      set({ name: "Down", changePct: -0.2 }),
      set({ name: "Up", changePct: 0.3 }),
    ];
    expect(names(filterAndSortSets(rows, q({ sort: "change" })))).toEqual([
      "Up",
      "Down",
      "None",
    ]);
  });

  it("by name", () => {
    const rows = [set({ name: "Zeta" }), set({ name: "Alpha" })];
    expect(names(filterAndSortSets(rows, q({ sort: "name" })))).toEqual([
      "Alpha",
      "Zeta",
    ]);
  });

  it("breaks exact ties by name then id so the order never flickers", () => {
    const a = set({ name: "Same", groupId: 9 });
    const b = set({ name: "Same", groupId: 3 });
    expect(
      filterAndSortSets([a, b], q({ sort: "value" })).map((r) => r.groupId),
    ).toEqual([3, 9]);
  });
});

describe("labels", () => {
  it("releaseLabel shows month and year, or a dash", () => {
    expect(releaseLabel("2025-01-17")).toBe("Jan 2025");
    expect(releaseLabel("2026-12-01")).toBe("Dec 2026");
    expect(releaseLabel(null)).toBe("—");
    expect(releaseLabel("soon")).toBe("—");
    expect(releaseLabel("2026-13-01")).toBe("—");
  });

  it("changeLabel signs with a real minus and dashes the unknown", () => {
    expect(changeLabel(0.123)).toBe("+12.3%");
    expect(changeLabel(-0.04)).toBe("−4.0%");
    expect(changeLabel(0)).toBe("0.0%");
    expect(changeLabel(null)).toBe("—");
  });
});

describe("bulkReleaseDates", () => {
  const many = (d: string, n: number) => Array.from({ length: n }, () => d);

  it("flags a date shared by at least the threshold number of sets", () => {
    const dates = [...many("2026-11-22", BULK_DATE_THRESHOLD), "2025-01-17"];
    expect([...bulkReleaseDates(dates)]).toEqual(["2026-11-22"]);
  });

  it("leaves a date just under the threshold alone", () => {
    expect(
      bulkReleaseDates(many("2023-01-20", BULK_DATE_THRESHOLD - 1)).size,
    ).toBe(0);
  });

  it("ignores missing dates and handles an empty list", () => {
    expect(bulkReleaseDates([null, null, ...many("2026-01-01", 3)]).size).toBe(
      0,
    );
    expect(bulkReleaseDates([]).size).toBe(0);
  });

  it("can flag several different bulk dates", () => {
    const dates = [
      ...many("2026-11-22", 12),
      ...many("2020-02-02", 11),
      "2024-04-04",
    ];
    expect([...bulkReleaseDates(dates)].sort()).toEqual([
      "2020-02-02",
      "2026-11-22",
    ]);
  });
});

describe("comparableChange", () => {
  const base = {
    totalCents: 1200,
    pricedCount: 100,
    priorTotalCents: 1000,
    priorPricedCount: 100,
  };

  it("reports the change when the same cards were priced then and now", () => {
    expect(comparableChange(base)).toBeCloseTo(0.2, 10);
    expect(comparableChange({ ...base, totalCents: 800 })).toBeCloseTo(
      -0.2,
      10,
    );
  });

  it("allows a small coverage difference but not a big one", () => {
    expect(comparableChange({ ...base, priorPricedCount: 90 })).not.toBeNull();
    expect(comparableChange({ ...base, priorPricedCount: 89 })).toBeNull();
  });

  it("refuses a 'change' that is really cards gaining prices", () => {
    expect(
      comparableChange({
        totalCents: 18_915,
        pricedCount: 40,
        priorTotalCents: 94,
        priorPricedCount: 1,
      }),
    ).toBeNull();
  });

  it("is null without a usable earlier day", () => {
    expect(comparableChange({ ...base, priorTotalCents: null })).toBeNull();
    expect(comparableChange({ ...base, priorPricedCount: null })).toBeNull();
    expect(comparableChange({ ...base, priorTotalCents: 0 })).toBeNull();
  });

  it("is null for a set with nothing priced today", () => {
    expect(comparableChange({ ...base, pricedCount: 0 })).toBeNull();
  });

  it("a set that lost a few priced cards still counts as comparable", () => {
    expect(
      comparableChange({ ...base, pricedCount: 90, priorPricedCount: 100 }),
    ).not.toBeNull();
  });
});
