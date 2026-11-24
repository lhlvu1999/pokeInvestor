import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  cleanTitle,
  DEFAULT_SHARE_OPTIONS,
  escapeHtml,
  renderSnapshotHtml,
  renderSnapshotText,
  snapshotFilename,
  type ShareLine,
  type ShareOptions,
} from "./share_snapshot";

const AS_OF = new Date("2026-11-23T10:00:00Z");
const money = (n: number) => `$${(n / 100).toFixed(2)}`;

// Distinctive cost figures so a leak is impossible to miss in a string search.
const lines: ShareLine[] = [
  {
    itemId: "1",
    name: "Alpha Box",
    tags: ["etb"],
    quantity: 2,
    marketUnit: 20_000,
    avgCost: 13_579,
  },
  {
    itemId: "2",
    name: "Beta Tin",
    tags: ["tin"],
    quantity: 1,
    marketUnit: null,
    avgCost: 24_681,
  },
  {
    itemId: "3",
    name: "Gamma Case",
    tags: ["etb", "case"],
    quantity: 3,
    marketUnit: 50_000,
    avgCost: 35_791,
  },
  {
    itemId: "4",
    name: "Sold Out",
    tags: [],
    quantity: 0,
    marketUnit: 10_000,
    avgCost: 11_111,
  },
];

const opts = (o: Partial<ShareOptions> = {}): ShareOptions => ({
  ...DEFAULT_SHARE_OPTIONS,
  ...o,
});

describe("buildSnapshot", () => {
  it("shares only items in hand, biggest value first", () => {
    const s = buildSnapshot(lines, opts(), "USD", AS_OF);
    expect(s.rows.map((r) => r.name)).toEqual([
      "Gamma Case",
      "Alpha Box",
      "Beta Tin",
    ]);
    expect(s.totals.items).toBe(3);
  });

  it("by default shows quantity, price and value but NOT cost or profit", () => {
    const s = buildSnapshot(lines, opts(), "USD", AS_OF);
    expect(s.columns).toEqual(["quantity", "unitPrice", "value"]);
    for (const r of s.rows) {
      expect("cost" in r).toBe(false);
      expect("profit" in r).toBe(false);
    }
    expect("cost" in s.totals).toBe(false);
    expect("profit" in s.totals).toBe(false);
  });

  it("computes values and totals from priced items only", () => {
    const s = buildSnapshot(lines, opts(), "USD", AS_OF);
    const alpha = s.rows.find((r) => r.name === "Alpha Box")!;
    expect(alpha.value).toBe(40_000);
    expect(s.rows.find((r) => r.name === "Beta Tin")!.value).toBeNull();
    // 3×50,000 + 2×20,000 = 190,000; Beta (unpriced) adds nothing.
    expect(s.totals.value).toBe(190_000);
    expect(s.totals.units).toBe(6);
    expect(s.unpriced).toBe(1);
  });

  it("adds cost and profit only when asked, with profit over priced items", () => {
    const s = buildSnapshot(
      lines,
      opts({ showCost: true, showProfit: true }),
      "USD",
      AS_OF,
    );
    const gamma = s.rows.find((r) => r.name === "Gamma Case")!;
    expect(gamma.cost).toBe(3 * 35_791);
    expect(gamma.profit).toBe(3 * 50_000 - 3 * 35_791);
    expect(s.rows.find((r) => r.name === "Beta Tin")!.profit).toBeNull();
    expect(s.totals.cost).toBe(2 * 13_579 + 24_681 + 3 * 35_791);
    expect(s.totals.profit).toBe(2 * (20_000 - 13_579) + 3 * (50_000 - 35_791));
  });

  it("can show profit without showing cost, and neither number leaks the other", () => {
    const s = buildSnapshot(lines, opts({ showProfit: true }), "USD", AS_OF);
    expect(s.columns).toContain("profit");
    expect(s.columns).not.toContain("cost");
    expect(s.rows.every((r) => !("cost" in r))).toBe(true);
  });

  it("filters by tag", () => {
    const s = buildSnapshot(lines, opts({ tag: "case" }), "USD", AS_OF);
    expect(s.rows.map((r) => r.name)).toEqual(["Gamma Case"]);
    expect(s.totals.items).toBe(1);
  });

  it("does not order by value when values are hidden (that would reveal a ranking)", () => {
    const s = buildSnapshot(
      lines,
      opts({ showValue: false, showUnitPrice: false }),
      "USD",
      AS_OF,
    );
    expect(s.rows.map((r) => r.name)).toEqual([
      "Alpha Box",
      "Beta Tin",
      "Gamma Case",
    ]);
    expect(s.totals.value).toBeUndefined();
    expect(s.columns).toEqual(["quantity"]);
  });

  it("states exactly what is and isn't included", () => {
    const def = buildSnapshot(lines, opts(), "USD", AS_OF);
    expect(def.includes).toEqual([
      "Item names",
      "Quantities",
      "Market price per unit",
      "Value at market price",
    ]);
    expect(def.excludes).toContain("What you paid");
    expect(def.excludes).toContain("Profit or loss");
    const all = buildSnapshot(
      lines,
      opts({ showCost: true, showProfit: true }),
      "USD",
      AS_OF,
    );
    expect(all.includes).toContain("What you paid");
    expect(all.excludes).not.toContain("What you paid");
  });

  it("handles nothing to share", () => {
    const s = buildSnapshot([], opts(), "USD", AS_OF);
    expect(s.rows).toEqual([]);
    expect(s.totals.items).toBe(0);
    expect(s.totals.value).toBe(0);
  });
});

describe("what reaches the recipient", () => {
  it("never contains a hidden cost or profit figure in HTML or text", () => {
    const s = buildSnapshot(lines, opts(), "USD", AS_OF);
    const html = renderSnapshotHtml(s, money);
    const text = renderSnapshotText(s, money);
    for (const secret of [
      "135.79",
      "246.81",
      "357.91",
      "13579",
      "24681",
      "35791",
      "Paid",
      "Profit",
    ]) {
      expect(html).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
  });

  it("does contain cost and profit when they were chosen", () => {
    const s = buildSnapshot(
      lines,
      opts({ showCost: true, showProfit: true }),
      "USD",
      AS_OF,
    );
    const html = renderSnapshotHtml(s, money);
    expect(html).toContain("$1073.73"); // Gamma paid 3 × 357.91
    expect(html).toContain("Paid");
    expect(html).toContain("Profit");
  });

  it("escapes item names and the title (no markup injection)", () => {
    const evil: ShareLine[] = [
      {
        itemId: "x",
        name: '<img src=x onerror="alert(1)"> & Co',
        tags: [],
        quantity: 1,
        marketUnit: 100,
        avgCost: 1,
      },
    ];
    const s = buildSnapshot(
      evil,
      opts({ title: "</title><script>alert(1)</script>" }),
      "USD",
      AS_OF,
    );
    const html = renderSnapshotHtml(s, money);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Co",
    );
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;");
  });

  it("is a complete page that mentions the as-of date and the estimate caveat", () => {
    const html = renderSnapshotHtml(
      buildSnapshot(lines, opts(), "USD", AS_OF),
      money,
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("As of November 23, 2026");
    expect(html).toContain("market estimates");
    expect(html).toContain("1 item has no market price yet");
  });

  it("text output lists each item with its quantity and the total", () => {
    const text = renderSnapshotText(
      buildSnapshot(lines, opts(), "USD", AS_OF),
      money,
    );
    expect(text).toContain(
      "Gamma Case — 3×, market price $500.00, value $1500.00",
    );
    expect(text).toContain("Total: 3 items, 6 units, worth $1900.00");
  });

  it("shows loss with a real minus sign", () => {
    const loss: ShareLine[] = [
      {
        itemId: "x",
        name: "Down",
        tags: [],
        quantity: 1,
        marketUnit: 100,
        avgCost: 500,
      },
    ];
    const s = buildSnapshot(loss, opts({ showProfit: true }), "USD", AS_OF);
    expect(renderSnapshotText(s, money)).toContain("profit −$4.00");
  });
});

describe("helpers", () => {
  it("escapeHtml covers the five characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("cleanTitle trims, collapses spaces, caps length and falls back", () => {
    expect(cleanTitle("  My   stuff ")).toBe("My stuff");
    expect(cleanTitle("   ")).toBe(DEFAULT_SHARE_OPTIONS.title);
    expect(cleanTitle("x".repeat(500)).length).toBe(120);
  });

  it("builds a safe filename from the title and date", () => {
    const s = buildSnapshot(
      lines,
      opts({ title: "Bruce's Pokémon / 2026!" }),
      "USD",
      AS_OF,
    );
    expect(snapshotFilename(s)).toBe("bruce-s-pok-mon-2026-2026-11-23.html");
    const blank = buildSnapshot(lines, opts({ title: "***" }), "USD", AS_OF);
    expect(snapshotFilename(blank)).toMatch(/\.html$/);
  });
});
