import { describe, expect, it } from "vitest";
import {
  checkImages,
  inspectDataUrl,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_ROWS,
  parseExtraction,
  toRawRows,
  VISION_SYSTEM_PROMPT,
} from "./screenshot_import";
import { buildPreview } from "./import";

const row = (over: Record<string, unknown> = {}) => ({
  item: "Black Bolt Elite Trainer Box",
  quantity: 4,
  dateIn: "2025-11-07",
  amountIn: 8_400_000,
  dateOut: "2026-01-15",
  amountOut: 11_200_000,
  ...over,
});
const reply = (rows: unknown[]) => JSON.stringify({ rows });

describe("parseExtraction", () => {
  it("keeps a clean row exactly as given", () => {
    const e = parseExtraction(reply([row()]));
    expect(e.rejected).toBe(0);
    expect(e.rows).toEqual([row()]);
  });

  it("accepts an unsold row (null sale) and a bare array reply", () => {
    const e = parseExtraction(
      JSON.stringify([row({ dateOut: null, amountOut: null })]),
    );
    expect(e.rows).toHaveLength(1);
    expect(e.rows[0].dateOut).toBeNull();
    expect(e.rows[0].amountOut).toBeNull();
  });

  it("tolerates code fences and chatter around the JSON", () => {
    const wrapped =
      "Here you go:\n```json\n" + reply([row()]) + "\n```\nHope that helps!";
    expect(parseExtraction(wrapped).rows).toHaveLength(1);
    expect(
      parseExtraction("```\n" + reply([row()]) + "\n```").rows,
    ).toHaveLength(1);
  });

  it("returns nothing, not an error, for non-JSON or an empty reply", () => {
    expect(parseExtraction("I can't read these images.")).toEqual({
      rows: [],
      rejected: 0,
    });
    expect(parseExtraction("")).toEqual({ rows: [], rejected: 0 });
    expect(parseExtraction(reply([]))).toEqual({ rows: [], rejected: 0 });
    expect(parseExtraction('{"answer": 42}')).toEqual({
      rows: [],
      rejected: 0,
    });
  });

  it("drops rows with unreadable fields and counts them, never repairing", () => {
    const e = parseExtraction(
      reply([
        row(),
        row({ item: "" }),
        row({ dateIn: "03/04/2025" }), // not ISO: ambiguous, so refused
        row({ dateIn: "2025-02-30" }), // not a real day
        row({ amountIn: "about 500" }),
        row({ amountIn: -5 }),
        row({ quantity: 0 }),
        row({ quantity: 2.5 }),
        row({ amountIn: null }),
        "not a row",
        null,
      ]),
    );
    expect(e.rows).toHaveLength(1);
    expect(e.rejected).toBe(10);
  });

  it("rejects a half-recorded sale and a sale before the purchase", () => {
    const e = parseExtraction(
      reply([
        row({ dateOut: "2026-01-15", amountOut: null }),
        row({ dateOut: null, amountOut: 500 }),
        row({ dateOut: "2025-01-01", amountOut: 500 }), // before dateIn
        row({ dateOut: "garbage", amountOut: 500 }),
      ]),
    );
    expect(e.rows).toEqual([]);
    expect(e.rejected).toBe(4);
  });

  it("allows a sale for zero (written off) and a same-day sale", () => {
    const e = parseExtraction(
      reply([
        row({ amountOut: 0 }),
        row({ dateOut: "2025-11-07", amountOut: 5 }),
      ]),
    );
    expect(e.rows).toHaveLength(2);
  });

  it("reads numeric strings only when they are plain numbers", () => {
    const e = parseExtraction(
      reply([row({ amountIn: "8400000" }), row({ amountIn: "8,400,000" })]),
    );
    expect(e.rows).toHaveLength(1);
    expect(e.rejected).toBe(1);
  });

  it("collapses spaces in names and refuses an absurdly long one", () => {
    const e = parseExtraction(
      reply([
        row({ item: "  Black   Bolt\nETB " }),
        row({ item: "x".repeat(300) }),
      ]),
    );
    expect(e.rows[0].item).toBe("Black Bolt ETB");
    expect(e.rejected).toBe(1);
  });

  it("caps how many rows it will take and counts the excess", () => {
    const many = Array.from({ length: MAX_ROWS + 25 }, () => row());
    const e = parseExtraction(reply(many));
    expect(e.rows).toHaveLength(MAX_ROWS);
    expect(e.rejected).toBe(25);
  });
});

describe("toRawRows", () => {
  it("puts the quantity back as an ' x N' suffix and keeps ISO dates", () => {
    const [r] = toRawRows(parseExtraction(reply([row()])).rows);
    expect(r).toEqual({
      item: "Black Bolt Elite Trainer Box x 4",
      inStock: "",
      dateIn: "2025-11-07",
      amountIn: "8400000",
      dateOut: "2026-01-15",
      amountOut: "11200000",
    });
  });

  it("leaves a single unit without a suffix and an unsold row without sale fields", () => {
    const [r] = toRawRows(
      parseExtraction(
        reply([row({ quantity: 1, dateOut: null, amountOut: null })]),
      ).rows,
    );
    expect(r.item).toBe("Black Bolt Elite Trainer Box");
    expect(r.dateOut).toBe("");
    expect(r.amountOut).toBe("");
  });

  it("feeds the importer with no errors and the right buys and sells", () => {
    const rows = toRawRows(
      parseExtraction(
        reply([
          row(),
          row({ item: "Tin", quantity: 1, dateOut: null, amountOut: null }),
        ]),
      ).rows,
    );
    const p = buildPreview(rows);
    expect(p.errors).toEqual([]);
    expect(p.totalBuys).toBe(2);
    expect(p.totalSells).toBe(1);
    expect(p.rows[0].quantity).toBe(4);
  });
});

describe("image checks", () => {
  const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");
  const url = (n: number, mime = "image/png") =>
    `data:${mime};base64,${b64(n)}`;

  it("measures a data URL without trusting its length claims", () => {
    expect(inspectDataUrl(url(300))).toEqual({ mime: "image/png", bytes: 300 });
    expect(inspectDataUrl(url(301))).toEqual({ mime: "image/png", bytes: 301 });
    expect(inspectDataUrl("data:text/plain,hello")).toBeNull();
    expect(inspectDataUrl("https://example.com/a.png")).toBeNull();
    expect(inspectDataUrl("data:image/png;base64,@@@")).toBeNull();
  });

  it("accepts normal images", () => {
    expect(
      checkImages([url(1000), url(2000, "image/jpeg"), url(10, "image/webp")]),
    ).toEqual({ ok: true });
  });

  it("refuses none, too many, other types, and oversize images", () => {
    expect(checkImages([]).ok).toBe(false);
    expect(
      checkImages(Array.from({ length: MAX_IMAGES + 1 }, () => url(10))).ok,
    ).toBe(false);
    const gif = checkImages([url(10, "image/gif")]);
    expect(gif.ok).toBe(false);
    if (!gif.ok) expect(gif.error).toContain("PNG, JPEG or WebP");
    const big = checkImages([url(MAX_IMAGE_BYTES + 10)]);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toContain("too large");
    expect(checkImages([url(MAX_IMAGE_BYTES)]).ok).toBe(true);
  });

  it("names which screenshot is the problem", () => {
    const r = checkImages([url(10), "not an image"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Screenshot 2");
  });
});

describe("prompt", () => {
  it("tells the model not to guess and to use ISO dates", () => {
    expect(VISION_SYSTEM_PROMPT).toContain("Never guess");
    expect(VISION_SYSTEM_PROMPT).toContain("YYYY-MM-DD");
  });
});
