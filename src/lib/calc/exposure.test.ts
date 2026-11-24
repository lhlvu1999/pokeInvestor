import { describe, expect, it } from "vitest";
import { concentration, sliceBy, type Holding } from "./exposure";

const h = (over: Partial<Holding> & { itemId: string; value: number }): Holding => ({
  name: over.itemId,
  atCost: false,
  kind: "etb",
  language: "en",
  setId: 1,
  setName: "Set A",
  ...over,
});

const holdings = [
  h({ itemId: "a", value: 500, kind: "etb", setId: 1, setName: "Set A" }),
  h({ itemId: "b", value: 300, kind: "box", setId: 2, setName: "Set B" }),
  h({ itemId: "c", value: 100, kind: "etb", setId: 1, setName: "Set A", atCost: true }),
  h({ itemId: "d", value: 100, kind: "unlinked", language: null, setId: null, setName: null }),
  h({ itemId: "e", value: 0 }),
];

describe("sliceBy", () => {
  it("splits value by a key, biggest first, with shares that add to 1", () => {
    const s = sliceBy(holdings, (x) => ({ key: x.kind, label: x.kind }));
    expect(s.map((x) => [x.key, x.value, x.items])).toEqual([
      ["etb", 600, 2],
      ["box", 300, 1],
      ["unlinked", 100, 1],
    ]);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 12);
    expect(s[0].share).toBeCloseTo(0.6, 12);
  });

  it("tracks how much of a slice is at cost", () => {
    const s = sliceBy(holdings, (x) => ({ key: x.kind, label: x.kind }));
    expect(s[0].atCostValue).toBe(100);
    expect(s[1].atCostValue).toBe(0);
  });

  it("ignores zero and negative values and handles nothing", () => {
    expect(sliceBy([h({ itemId: "z", value: 0 })], (x) => ({ key: x.kind, label: x.kind }))).toEqual([]);
    expect(sliceBy([], (x) => ({ key: x.kind, label: x.kind }))).toEqual([]);
  });

  it("breaks ties by label", () => {
    const s = sliceBy(
      [h({ itemId: "p", value: 10, kind: "pack" }), h({ itemId: "q", value: 10, kind: "box" })],
      (x) => ({ key: x.kind, label: x.kind }),
    );
    expect(s.map((x) => x.key)).toEqual(["box", "pack"]);
  });
});

describe("concentration", () => {
  it("is the share held in the biggest one and five items", () => {
    const c = concentration(holdings);
    expect(c.total).toBe(1000);
    expect(c.items).toBe(4);
    expect(c.top1).toBeCloseTo(0.5, 12);
    expect(c.top5).toBeCloseTo(1, 12); // only four items have value
  });
  it("covers a long list", () => {
    const many = Array.from({ length: 10 }, (_, i) => h({ itemId: `i${i}`, value: 10 }));
    const c = concentration(many);
    expect(c.top1).toBeCloseTo(0.1, 12);
    expect(c.top5).toBeCloseTo(0.5, 12);
  });
  it("is zero for an empty stock", () => {
    expect(concentration([])).toEqual({ total: 0, items: 0, top1: 0, top5: 0 });
  });
});
