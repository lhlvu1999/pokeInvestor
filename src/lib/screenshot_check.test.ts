import { describe, expect, it } from "vitest";
import {
  compareExtraction,
  normalizeName,
  type Expected,
} from "./screenshot_check";
import type { ExtractedRow } from "./screenshot_import";

const row = (over: Partial<ExtractedRow> = {}): ExtractedRow => ({
  item: "Ascended Heroes Elite Trainer Box",
  quantity: 3,
  dateIn: "2026-03-12",
  amountIn: 8070000,
  dateOut: "2026-04-20",
  amountOut: 9900000,
  ...over,
});

const expected: Expected = {
  rows: [
    row(),
    row({
      item: "Surging Sparks Booster Box",
      quantity: 1,
      dateIn: "2026-02-02",
      amountIn: 3650000,
      dateOut: null,
      amountOut: null,
    }),
  ],
  mustOmit: ["Black Bolt"],
};

describe("normalizeName", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    expect(normalizeName("Pokémon  TCG: 151 Ultra-Premium")).toBe(
      "pokemon tcg 151 ultra premium",
    );
  });
});

describe("compareExtraction", () => {
  it("passes a perfect reading", () => {
    const r = compareExtraction(expected, expected.rows);
    expect(r).toMatchObject({
      correct: 2,
      wrong: 0,
      missing: 0,
      safe: true,
      complete: true,
    });
    expect(r.invented).toEqual([]);
  });

  it("fails a wrong value and says which", () => {
    const r = compareExtraction(expected, [
      row({ amountIn: 8700000 }),
      expected.rows[1],
    ]);
    expect(r.wrong).toBe(1);
    expect(r.safe).toBe(false);
    expect(r.rows[0].differences).toEqual(["paid 8700000, expected 8070000"]);
  });

  it("catches a misread date, quantity and a sale that wasn't there", () => {
    const r = compareExtraction(expected, [
      row({ dateIn: "2026-12-03", quantity: 8 }),
      { ...expected.rows[1], dateOut: "2026-03-01", amountOut: 1 },
    ]);
    expect(r.rows[0].differences).toEqual([
      "quantity 8, expected 3",
      "bought 2026-12-03, expected 2026-03-12",
    ]);
    expect(r.rows[1].differences).toEqual([
      "sold 2026-03-01, expected never",
      "received 1, expected nothing",
    ]);
  });

  it("reports an unreadable-but-present row as missing, which isn't unsafe", () => {
    const r = compareExtraction(expected, [expected.rows[0]]);
    expect(r.missing).toBe(1);
    expect(r.safe).toBe(true);
    expect(r.complete).toBe(false);
  });

  it("fails a row that isn't on the page", () => {
    const r = compareExtraction(expected, [
      ...expected.rows,
      row({ item: "Phantom Box", quantity: 1 }),
    ]);
    expect(r.invented.map((x) => x.item)).toEqual(["Phantom Box"]);
    expect(r.safe).toBe(false);
  });

  it("fails a row the prompt said to leave out", () => {
    const r = compareExtraction(expected, [
      ...expected.rows,
      row({ item: "Black Bolt Elite Trainer Box", dateIn: "2026-04-03" }),
    ]);
    expect(r.forbidden.map((x) => x.item)).toEqual([
      "Black Bolt Elite Trainer Box",
    ]);
    expect(r.invented).toEqual([]);
    expect(r.safe).toBe(false);
  });

  it("accepts a shortened item name but notes it", () => {
    const e: Expected = {
      rows: [row({ item: "Pokémon TCG Surging Sparks Booster Bundle" })],
    };
    const r = compareExtraction(e, [row({ item: "Surging Sparks Booster Bundle" })]);
    expect(r.correct).toBe(1);
    expect(r.rows[0].notes[0]).toContain("page says");
  });

  it("matches repeats of one product by purchase date", () => {
    const e: Expected = {
      rows: [
        row({ dateIn: "2026-01-01", amountIn: 100 }),
        row({ dateIn: "2026-02-01", amountIn: 200 }),
      ],
    };
    const r = compareExtraction(e, [
      row({ dateIn: "2026-02-01", amountIn: 200 }),
      row({ dateIn: "2026-01-01", amountIn: 100 }),
    ]);
    expect(r.correct).toBe(2);
  });

  it("treats any row on a page that has none as invented", () => {
    const r = compareExtraction({ rows: [] }, [row()]);
    expect(r.invented).toHaveLength(1);
    expect(r.safe).toBe(false);
    expect(compareExtraction({ rows: [] }, []).safe).toBe(true);
  });

  it("allows tiny rounding in amounts and counts rejected rows", () => {
    const e: Expected = { rows: [row({ amountIn: 27.5, dateOut: null, amountOut: null })] };
    const r = compareExtraction(
      e,
      [row({ amountIn: 27.504, dateOut: null, amountOut: null })],
      2,
    );
    expect(r.correct).toBe(1);
    expect(r.rejected).toBe(2);
  });
});
