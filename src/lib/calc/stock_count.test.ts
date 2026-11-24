import { describe, expect, it } from "vitest";
import {
  parseCount,
  reconcile,
  shortfallsOf,
  summarizeCount,
  type CountRow,
} from "./stock_count";

const rows: CountRow[] = [
  { itemId: "a", name: "A", ledger: 5, avgCost: 1000 },
  { itemId: "b", name: "B", ledger: 3, avgCost: 2000 },
  { itemId: "c", name: "C", ledger: 2, avgCost: 500 },
  { itemId: "d", name: "D", ledger: 4, avgCost: 700 },
];

describe("parseCount", () => {
  it("reads whole numbers, trimming spaces", () => {
    expect(parseCount("5")).toBe(5);
    expect(parseCount(" 12 ")).toBe(12);
    expect(parseCount("0")).toBe(0);
  });
  it("treats blank as not counted, never zero", () => {
    expect(parseCount("")).toBeNull();
    expect(parseCount("   ")).toBeNull();
    expect(parseCount(undefined)).toBeNull();
  });
  it("flags anything else as invalid", () => {
    for (const bad of ["-1", "2.5", "abc", "1e3", "5 units", "9".repeat(20)]) {
      expect(parseCount(bad)).toBe("invalid");
    }
  });
});

describe("reconcile", () => {
  const lines = reconcile(rows, { a: "5", b: "1", c: "4" });
  const by = Object.fromEntries(lines.map((l) => [l.itemId, l]));

  it("matches, short, over and uncounted", () => {
    expect(by.a.status).toBe("match");
    expect(by.b.status).toBe("short");
    expect(by.c.status).toBe("over");
    expect(by.d.status).toBe("uncounted");
  });

  it("carries the difference, negative when missing", () => {
    expect(by.b.diff).toBe(-2);
    expect(by.c.diff).toBe(2);
    expect(by.a.diff).toBe(0);
    expect(by.d.diff).toBeNull();
  });

  it("prices the missing units at cost basis, only for shortages", () => {
    expect(by.b.missingCost).toBe(4000);
    expect(by.c.missingCost).toBe(0);
    expect(by.a.missingCost).toBe(0);
  });

  it("an explicit zero is a real count: everything missing", () => {
    const z = reconcile(rows, { a: "0" })[0];
    expect(z.status).toBe("short");
    expect(z.diff).toBe(-5);
    expect(z.missingCost).toBe(5000);
  });

  it("marks unreadable input invalid rather than guessing", () => {
    const l = reconcile(rows, { a: "five" })[0];
    expect(l.status).toBe("invalid");
    expect(l.counted).toBeNull();
  });

  it("keeps the input order and does not mutate rows", () => {
    expect(lines.map((l) => l.itemId)).toEqual(["a", "b", "c", "d"]);
    expect(rows[0]).toEqual({
      itemId: "a",
      name: "A",
      ledger: 5,
      avgCost: 1000,
    });
  });
});

describe("summarizeCount", () => {
  it("totals what matches and where the gaps are", () => {
    const s = summarizeCount(
      reconcile(rows, { a: "5", b: "1", c: "4", d: "x" }),
    );
    expect(s).toEqual({
      counted: 3,
      uncounted: 0,
      invalid: 1,
      matches: 1,
      shortItems: 1,
      missingUnits: 2,
      missingCost: 4000,
      overItems: 1,
      extraUnits: 2,
    });
  });

  it("does not count uncounted items as missing", () => {
    const s = summarizeCount(reconcile(rows, {}));
    expect(s.counted).toBe(0);
    expect(s.uncounted).toBe(4);
    expect(s.missingUnits).toBe(0);
  });
});

describe("shortfallsOf", () => {
  it("lists only short items, with the ledger figure they were counted against", () => {
    const f = shortfallsOf(reconcile(rows, { a: "5", b: "1", c: "4", d: "0" }));
    expect(f).toEqual([
      { itemId: "b", missing: 2, expectedHeld: 3 },
      { itemId: "d", missing: 4, expectedHeld: 4 },
    ]);
  });

  it("is empty when nothing is short", () => {
    expect(shortfallsOf(reconcile(rows, { a: "5", c: "9" }))).toEqual([]);
  });
});
