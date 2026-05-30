import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import {
  buildPreview,
  checkHeaderRow,
  extractQuantity,
  itemMatchKey,
  parseUsDate,
  transformRow,
  type RawCsvRow,
} from "./import";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    const out = parseCsv("a,b,c\n1,2,3\n");
    expect(out).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas", () => {
    const out = parseCsv(`a,"b,c",d\n1,"two, three",4\n`);
    expect(out).toEqual([
      ["a", "b,c", "d"],
      ["1", "two, three", "4"],
    ]);
  });

  it("handles escaped quotes", () => {
    const out = parseCsv(`a,"sa""y",b\n`);
    expect(out).toEqual([["a", 'sa"y', "b"]]);
  });

  it("handles CRLF and trailing newline", () => {
    const out = parseCsv("a,b\r\n1,2\r\n\r\n");
    expect(out).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips BOM", () => {
    const out = parseCsv("﻿a,b\n1,2\n");
    expect(out[0]).toEqual(["a", "b"]);
  });
});

describe("checkHeaderRow", () => {
  it("accepts the expected columns", () => {
    expect(
      checkHeaderRow([
        "Item",
        "In stock",
        "Date IN",
        "IN",
        "Date Out",
        "OUT",
        "% profit",
        "Profit",
      ]),
    ).toBeNull();
  });
  it("rejects when a column is missing", () => {
    expect(
      checkHeaderRow(["Item", "Date IN", "IN", "Date Out", "OUT"]),
    ).toMatch(/In stock/);
  });
});

describe("extractQuantity", () => {
  it.each([
    ["box sv4a x 60", "box sv4a", 60],
    ["etb black", "etb black", 1],
    ["promo mimikyu x 8 ", "promo mimikyu", 8],
    ["case prismatic (12) poster x 8", "case prismatic (12) poster", 8],
    ["mega 2.5 pin x 9", "mega 2.5 pin", 9],
    ["case 2.5 pin x 10", "case 2.5 pin", 10],
    ["x", "x", 1], // single 'x' is not a quantity
    ["item x abc", "item x abc", 1], // non-numeric tail
    ["  spaced  name  ", "spaced name", 1],
  ])("%s -> %s, %d", (input, expectedName, expectedQty) => {
    const { name, quantity } = extractQuantity(input);
    expect(name).toBe(expectedName);
    expect(quantity).toBe(expectedQty);
  });

  it("preserves descriptive parentheticals", () => {
    expect(extractQuantity("slabs psa 10 iron ex (3slabs)")).toEqual({
      name: "slabs psa 10 iron ex (3slabs)",
      quantity: 1,
    });
  });
});

describe("itemMatchKey", () => {
  it("collapses case", () => {
    expect(itemMatchKey("etb black")).toBe(itemMatchKey("etb Black"));
    expect(itemMatchKey("etb White")).toBe(itemMatchKey("etb white"));
  });
});

describe("parseUsDate", () => {
  it("parses M/D/YYYY", () => {
    const d = parseUsDate("9/25/2025", 9);
    expect(d?.getUTCFullYear()).toBe(2025);
    expect(d?.getUTCMonth()).toBe(8); // September
    expect(d?.getUTCDate()).toBe(25);
    expect(d?.getUTCHours()).toBe(9);
  });
  it("parses 2-digit month/day", () => {
    expect(parseUsDate("10/11/2025", 9)?.getUTCDate()).toBe(11);
  });
  it("rejects invalid formats", () => {
    expect(parseUsDate("not a date", 9)).toBeNull();
    expect(parseUsDate("13/40/2025", 9)).toBeNull();
    expect(parseUsDate("", 9)).toBeNull();
  });
});

const baseRow = (overrides: Partial<RawCsvRow> = {}): RawCsvRow => ({
  item: "etb destined rivals",
  inStock: "TRUE",
  dateIn: "10/20/2025",
  amountIn: "2760",
  dateOut: "4/26/2026",
  amountOut: "6000",
  ...overrides,
});

describe("transformRow", () => {
  it("creates buy + sell when both sides present", () => {
    const r = transformRow(baseRow(), 1);
    expect(r && "transactions" in r).toBe(true);
    if (!r || "reason" in r) throw new Error();
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0].type).toBe("buy");
    expect(r.transactions[0].amountMinor).toBe(2760);
    expect(r.transactions[1].type).toBe("sell");
    expect(r.transactions[1].amountMinor).toBe(6000);
  });

  it("creates buy-only when no sell date/amount", () => {
    const r = transformRow(
      baseRow({ dateOut: "", amountOut: "" }),
      1,
    );
    if (!r || "reason" in r) throw new Error();
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].type).toBe("buy");
  });

  it("treats OUT=0 with Date Out as a sell at zero (write-off)", () => {
    const r = transformRow(
      baseRow({ dateOut: "2/12/2026", amountOut: "0" }),
      1,
    );
    if (!r || "reason" in r) throw new Error();
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[1].type).toBe("sell");
    expect(r.transactions[1].amountMinor).toBe(0);
  });

  it("returns error when Date Out is set but OUT is missing", () => {
    const r = transformRow(
      baseRow({ dateOut: "2/12/2026", amountOut: "" }),
      1,
    );
    expect(r && "reason" in r).toBe(true);
  });

  it("extracts quantity from name suffix", () => {
    const r = transformRow(
      baseRow({ item: "box sv4a x 60", amountIn: "159000", amountOut: "208140" }),
      1,
    );
    if (!r || "reason" in r) throw new Error();
    expect(r.itemDisplayName).toBe("box sv4a");
    expect(r.quantity).toBe(60);
    expect(r.transactions[0].quantity).toBe(60);
    expect(r.transactions[0].amountMinor).toBe(159000);
  });

  it("returns error on bad Date IN", () => {
    const r = transformRow(baseRow({ dateIn: "garbage" }), 5);
    expect(r && "reason" in r).toBe(true);
    if (!r || !("reason" in r)) throw new Error();
    expect(r.reason).toMatch(/Date IN/);
    expect(r.rowIndex).toBe(5);
  });

  it("returns error on bad IN amount", () => {
    const r = transformRow(baseRow({ amountIn: "" }), 1);
    expect(r && "reason" in r).toBe(true);
  });

  it("returns null on fully blank row", () => {
    const r = transformRow(
      {
        item: "",
        inStock: "",
        dateIn: "",
        amountIn: "",
        dateOut: "",
        amountOut: "",
      },
      1,
    );
    expect(r).toBeNull();
  });

  it("rejects sell-before-buy", () => {
    const r = transformRow(
      baseRow({ dateIn: "10/20/2025", dateOut: "10/19/2025" }),
      1,
    );
    expect(r && "reason" in r).toBe(true);
  });

  it("scales amounts by valueMultiplier", () => {
    const r = transformRow(
      baseRow({ amountIn: "1850", amountOut: "2800" }),
      1,
      { valueMultiplier: 1000 },
    );
    if (!r || "reason" in r) throw new Error();
    expect(r.transactions[0].amountMinor).toBe(1_850_000);
    expect(r.transactions[1].amountMinor).toBe(2_800_000);
  });

  it("times same-day buy before sell", () => {
    const r = transformRow(
      baseRow({ dateIn: "4/13/2026", dateOut: "4/13/2026" }),
      1,
    );
    if (!r || "reason" in r) throw new Error();
    expect(r.transactions[0].occurredAt.getTime()).toBeLessThan(
      r.transactions[1].occurredAt.getTime(),
    );
  });
});

describe("buildPreview", () => {
  it("dedupes items case-insensitively across rows", () => {
    const preview = buildPreview([
      baseRow({ item: "etb black", amountIn: "2100", dateOut: "", amountOut: "" }),
      baseRow({ item: "etb Black", amountIn: "2100", dateOut: "", amountOut: "" }),
      baseRow({ item: "etb destined rivals", amountIn: "2625" }),
    ]);
    expect(preview.uniqueItems).toHaveLength(2);
    expect(preview.errors).toHaveLength(0);
    expect(preview.totalBuys).toBe(3);
    expect(preview.totalSells).toBe(1);
  });

  it("collects errors per row without short-circuiting", () => {
    const preview = buildPreview([
      baseRow({ item: "good item", amountIn: "100", dateOut: "", amountOut: "" }),
      baseRow({ item: "bad date", dateIn: "garbage" }),
    ]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.errors).toHaveLength(1);
  });
});
