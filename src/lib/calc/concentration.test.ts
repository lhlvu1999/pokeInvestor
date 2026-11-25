import { describe, expect, it } from "vitest";
import { classifyTag, concentrationRows, otherTagCount } from "./concentration";

const sets = new Set(["ascended heroes", "prismatic evolutions"]);
const tags = [
  { tag: "ascended heroes", inventoryCost: 600, itemsHeld: 3 },
  { tag: "mega2.5", inventoryCost: 600, itemsHeld: 3 }, // old nickname, same stock
  { tag: "etb", inventoryCost: 300, itemsHeld: 2 },
  { tag: "slab", inventoryCost: 100, itemsHeld: 5 },
  { tag: "prismatic evolutions", inventoryCost: 250, itemsHeld: 1 },
  { tag: "empty", inventoryCost: 0, itemsHeld: 0 },
];

describe("classifyTag", () => {
  it("knows sets, kinds of product and your own labels", () => {
    expect(classifyTag("ascended heroes", sets)).toBe("set");
    expect(classifyTag("etb", sets)).toBe("type");
    expect(classifyTag("booster box", sets)).toBe("type");
    expect(classifyTag("mega2.5", sets)).toBe("other");
  });
  it("a set name that contains a product word is still a set", () => {
    expect(classifyTag("miscellaneous cards & products", new Set(["miscellaneous cards & products"]))).toBe("set");
  });
});

describe("concentrationRows", () => {
  it("lists sets biggest first with their share of everything held", () => {
    const r = concentrationRows(tags, 1000, sets, "sets");
    expect(r.map((x) => [x.tag, x.share])).toEqual([
      ["ascended heroes", 0.6],
      ["prismatic evolutions", 0.25],
    ]);
  });
  it("lists kinds of product on their own", () => {
    expect(concentrationRows(tags, 1000, sets, "types").map((x) => x.tag)).toEqual(["etb", "slab"]);
  });
  it("lists everything under all, but never a tag that holds nothing", () => {
    const r = concentrationRows(tags, 1000, sets, "all");
    expect(r.map((x) => x.tag)).toEqual(["ascended heroes", "mega2.5", "etb", "prismatic evolutions", "slab"]);
  });
  it("is empty with nothing held", () => {
    expect(concentrationRows(tags, 0, sets, "all")).toEqual([]);
    expect(concentrationRows([], 1000, sets, "all")).toEqual([]);
  });
  it("never reports more than 100%", () => {
    expect(concentrationRows([{ tag: "etb", inventoryCost: 2000, itemsHeld: 1 }], 1000, sets, "all")[0].share).toBe(1);
  });
});

describe("otherTagCount", () => {
  it("counts your own labels that hold stock", () => {
    expect(otherTagCount(tags, sets)).toBe(1);
  });
});
