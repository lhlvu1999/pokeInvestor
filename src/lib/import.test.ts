import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "./csv";
import {
  buildPreview,
  checkHeaderRow,
  detectDateOrder,
  extractQuantity,
  IMPORT_TEMPLATE_CSV,
  itemMatchKey,
  mapHeader,
  parseDate,
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
  it("no longer needs the unused 'In stock' column", () => {
    expect(
      checkHeaderRow(["Item", "Date IN", "IN", "Date Out", "OUT"]),
    ).toBeNull();
  });
  it("needs only Item, Date IN and IN", () => {
    expect(checkHeaderRow(["Item", "Date IN", "IN"])).toBeNull();
  });
  it("names exactly what is missing and what the file has", () => {
    const msg = checkHeaderRow(["Product", "When", "Cost"]);
    expect(msg).toContain('"Date IN"');
    expect(msg).not.toContain('"Item"');
    expect(msg).toContain("Your file's columns are: Product, When, Cost");
    expect(msg).toContain("template");
  });
  it("lists several missing columns together", () => {
    const msg = checkHeaderRow(["Foo", "Bar"]);
    expect(msg).toContain('"Item"');
    expect(msg).toContain('"Date IN"');
    expect(msg).toContain('"IN"');
  });
});

describe("mapHeader", () => {
  it("accepts any case, underscores and common alternative names", () => {
    const m = mapHeader([
      "Product Name",
      "buy_date",
      "Cost",
      "sold",
      "Sold For",
    ]);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.index).toEqual({
        item: 0,
        dateIn: 1,
        amountIn: 2,
        dateOut: 3,
        amountOut: 4,
      });
      expect(m.renamed).toContainEqual({ found: "Product Name", as: "Item" });
      expect(m.renamed).toContainEqual({ found: "buy_date", as: "Date IN" });
    }
  });
  it("does not report a column as renamed when it already matches", () => {
    const m = mapHeader(["Item", "Date IN", "IN"]);
    expect(m.ok && m.renamed).toEqual([]);
  });
  it("reports columns it does not use", () => {
    const m = mapHeader(["Item", "Date IN", "IN", "% profit", "Profit"]);
    expect(m.ok && m.ignored).toEqual(["% profit", "Profit"]);
  });
  it("never maps one column to two fields", () => {
    // "in" is both an alias for the buy amount and (via "in stock") unrelated;
    // a single "IN" column must go to amountIn only.
    const m = mapHeader(["Item", "Date IN", "IN"]);
    expect(m.ok && Object.values(m.index).sort()).toEqual([0, 1, 2]);
  });
});

describe("parseDate", () => {
  it("reads ISO dates the same in either order", () => {
    expect(parseDate("2025-09-25", 9, "mdy")?.getUTCMonth()).toBe(8);
    expect(parseDate("2025-09-25", 9, "dmy")?.getUTCDate()).toBe(25);
  });
  it("reads 3/4/2025 as March 4 month-first and 3 April day-first", () => {
    const us = parseDate("3/4/2025", 9, "mdy")!;
    const eu = parseDate("3/4/2025", 9, "dmy")!;
    expect([us.getUTCMonth(), us.getUTCDate()]).toEqual([2, 4]);
    expect([eu.getUTCMonth(), eu.getUTCDate()]).toEqual([3, 3]);
  });
  it("accepts dash and dot separators and two-digit years", () => {
    expect(parseDate("25-9-2025", 9, "dmy")?.getUTCDate()).toBe(25);
    expect(parseDate("25.9.25", 9, "dmy")?.getUTCFullYear()).toBe(2025);
  });
  it("rejects impossible dates in either order", () => {
    expect(parseDate("31/2/2025", 9, "dmy")).toBeNull();
    expect(parseDate("2/31/2025", 9, "mdy")).toBeNull();
    expect(parseDate("25/9/2025", 9, "mdy")).toBeNull();
    expect(parseDate("9/25/2025", 9, "dmy")).toBeNull();
    expect(parseDate("", 9)).toBeNull();
    expect(parseDate("yesterday", 9)).toBeNull();
  });
});

describe("detectDateOrder", () => {
  it("is day-first when some first number is over 12 and none of the second", () => {
    expect(detectDateOrder(["25/9/2025", "3/4/2025"])).toEqual({
      order: "dmy",
      certain: true,
    });
  });
  it("is month-first when some second number is over 12", () => {
    expect(detectDateOrder(["9/25/2025", "3/4/2025"])).toEqual({
      order: "mdy",
      certain: true,
    });
  });
  it("is an unconfirmed guess when every date reads both ways", () => {
    expect(detectDateOrder(["3/4/2025", "5/6/2025"])).toEqual({
      order: "mdy",
      certain: false,
    });
  });
  it("is unconfirmed when the file contradicts itself", () => {
    expect(detectDateOrder(["25/9/2025", "9/25/2025"]).certain).toBe(false);
  });
  it("ignores ISO dates and blanks", () => {
    expect(detectDateOrder(["2025-09-25", "", "  "]).certain).toBe(false);
  });
});

describe("transformRow with day-first dates", () => {
  it("reads the same row differently depending on the order, as chosen", () => {
    const row = baseRow({ dateIn: "3/4/2025", dateOut: "", amountOut: "" });
    const us = transformRow(row, 1, { dateOrder: "mdy" });
    const eu = transformRow(row, 1, { dateOrder: "dmy" });
    expect(
      us && "transactions" in us && us.transactions[0].occurredAt.getUTCMonth(),
    ).toBe(2);
    expect(
      eu && "transactions" in eu && eu.transactions[0].occurredAt.getUTCMonth(),
    ).toBe(3);
  });
  it("explains a date it cannot read in plain words", () => {
    const r = transformRow(baseRow({ dateIn: "soon" }), 3, {});
    expect(r && "reason" in r && r.reason).toBe(
      'Could not read the Date IN "soon" as a date',
    );
  });
});

describe("detectDelimiter / parseCsv delimiters", () => {
  it("detects tabs from spreadsheet paste, semicolons, and defaults to commas", () => {
    expect(detectDelimiter("Item\tDate IN\tIN\nA\t1/1/2025\t5")).toBe("\t");
    expect(detectDelimiter("Item;Date IN;IN\nA;1/1/2025;5")).toBe(";");
    expect(detectDelimiter("Item,Date IN,IN")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });
  it("parses tab- and semicolon-separated text", () => {
    expect(parseCsv("a\tb\tc\n1\t2\t3", "\t")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    expect(parseCsv("a;b\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("keeps commas inside a tab-separated cell", () => {
    expect(parseCsv("name\tprice\nBox, large\t1,850", "\t")[1]).toEqual([
      "Box, large",
      "1,850",
    ]);
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
    const r = transformRow(baseRow({ dateOut: "", amountOut: "" }), 1);
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
    const r = transformRow(baseRow({ dateOut: "2/12/2026", amountOut: "" }), 1);
    expect(r && "reason" in r).toBe(true);
  });

  it("extracts quantity from name suffix", () => {
    const r = transformRow(
      baseRow({
        item: "box sv4a x 60",
        amountIn: "159000",
        amountOut: "208140",
      }),
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
      baseRow({
        item: "etb black",
        amountIn: "2100",
        dateOut: "",
        amountOut: "",
      }),
      baseRow({
        item: "etb Black",
        amountIn: "2100",
        dateOut: "",
        amountOut: "",
      }),
      baseRow({ item: "etb destined rivals", amountIn: "2625" }),
    ]);
    expect(preview.uniqueItems).toHaveLength(2);
    expect(preview.errors).toHaveLength(0);
    expect(preview.totalBuys).toBe(3);
    expect(preview.totalSells).toBe(1);
  });

  it("collects errors per row without short-circuiting", () => {
    const preview = buildPreview([
      baseRow({
        item: "good item",
        amountIn: "100",
        dateOut: "",
        amountOut: "",
      }),
      baseRow({ item: "bad date", dateIn: "garbage" }),
    ]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.errors).toHaveLength(1);
  });
});

describe("IMPORT_TEMPLATE_CSV", () => {
  const grid = parseCsv(
    IMPORT_TEMPLATE_CSV,
    detectDelimiter(IMPORT_TEMPLATE_CSV),
  );
  const map = mapHeader(grid[0]);

  it("has a header the importer accepts", () => {
    expect(map.ok).toBe(true);
  });

  it("imports with no skipped rows and shows every case", () => {
    if (!map.ok) throw new Error("header");
    const col = (
      r: string[],
      f: "item" | "dateIn" | "amountIn" | "dateOut" | "amountOut",
    ) => r[map.index[f] ?? -1] ?? "";
    const rows = grid.slice(1).map((r) => ({
      item: col(r, "item"),
      inStock: "",
      dateIn: col(r, "dateIn"),
      amountIn: col(r, "amountIn"),
      dateOut: col(r, "dateOut"),
      amountOut: col(r, "amountOut"),
    }));
    const p = buildPreview(rows);
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(3);
    expect(p.totalBuys).toBe(3);
    expect(p.totalSells).toBe(2); // one row is still held
    expect(p.rows[0].quantity).toBe(4);
    const writtenOff = p.rows[2].transactions.find((t) => t.type === "sell");
    expect(writtenOff?.amountMinor).toBe(0);
  });
});
