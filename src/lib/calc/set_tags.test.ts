import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_TAGS_PER_ITEM,
  applyTagMerge,
  looksLikeProduct,
  planTagMerges,
  setTagName,
  withTag,
  type PlanItem,
} from "./set_tags";

const vectors = (
  JSON.parse(readFileSync("pipeline/tests/fixtures/set_tag_vectors.json", "utf8")) as {
    cases: { name: string; language: string; tag: string | null }[];
  }
).cases;

describe("setTagName (shared vectors with the pipeline)", () => {
  it("has plenty of cases", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(15);
  });
  for (const v of vectors) {
    it(`${JSON.stringify(v.name)} (${v.language}) -> ${JSON.stringify(v.tag)}`, () => {
      expect(setTagName(v.name, v.language)).toBe(v.tag);
    });
  }
});

describe("withTag", () => {
  it("adds once and keeps order", () => {
    expect(withTag(["etb"], "ascended heroes")).toEqual(["etb", "ascended heroes"]);
    expect(withTag(["etb", "x"], "etb")).toEqual(["etb", "x"]);
  });
  it("does not exceed the per-item limit", () => {
    const full = Array.from({ length: MAX_TAGS_PER_ITEM }, (_, i) => `t${i}`);
    expect(withTag(full, "new")).toEqual(full);
  });
});

const item = (id: string, tags: string[], setTag: string | null): PlanItem => ({ id, tags, setTag });

describe("planTagMerges", () => {
  const items = [
    item("a", ["mega2.5", "etb"], "ascended heroes"),
    item("b", ["mega2.5", "case"], "ascended heroes"),
    item("c", ["mega2.5"], null), // carries the tag but is not linked yet
    item("d", ["etb"], "chaos rising"),
    item("e", ["etb"], "pitch black"),
    item("f", ["case"], "mega evolution"),
    item("g", ["jp box"], "high class pack"), // one linked item only
    item("h", ["pris"], "prismatic evolutions"),
    item("i", ["pris"], "prismatic evolutions"),
  ];
  const plan = planTagMerges(items);
  const by = (t: string) => plan.find((p) => p.tag === t);

  it("offers a tag whose linked items all share one set", () => {
    expect(by("mega2.5")).toEqual({
      tag: "mega2.5",
      setTag: "ascended heroes",
      total: 3,
      linked: 2,
      unlinked: 1,
      productLike: false,
      strong: true,
    });
    expect(by("pris")?.setTag).toBe("prismatic evolutions");
  });
  it("leaves product types alone: a tag spread over several sets is not a set", () => {
    expect(by("etb")).toBeUndefined();
    expect(by("case")).toBeUndefined();
  });
  it("marks thin evidence (one linked item) as not strong", () => {
    expect(by("jp box")).toMatchObject({ linked: 1, strong: false });
  });
  it("never pre-selects a tag that names a kind of product, even with two linked items", () => {
    const p = planTagMerges([
      item("x", ["bundle"], "prismatic evolutions"),
      item("y", ["bundle"], "prismatic evolutions"),
      item("z", ["bundle"], null),
    ]);
    expect(p[0]).toMatchObject({ tag: "bundle", linked: 2, productLike: true, strong: false });
  });
  it("offers nothing for a tag with no linked item at all", () => {
    expect(planTagMerges([item("x", ["cz"], null)])).toEqual([]);
  });
  it("skips a tag that already equals its set tag", () => {
    expect(planTagMerges([item("x", ["surging sparks"], "surging sparks")])).toEqual([]);
  });
  it("orders strong proposals first, then by evidence", () => {
    expect(plan.map((p) => p.tag)).toEqual(["mega2.5", "pris", "jp box"]);
    expect(plan.find((p) => p.tag === "jp box")?.productLike).toBe(true);
  });
  it("counts an item once even if a tag is repeated on it", () => {
    const p = planTagMerges([item("x", ["a", "a"], "s1"), item("y", ["a"], "s1")]);
    expect(p[0]).toMatchObject({ total: 2, linked: 2 });
  });
});

describe("applyTagMerge", () => {
  const items = [
    item("a", ["mega2.5", "etb"], "ascended heroes"),
    item("c", ["mega2.5"], null),
    item("d", ["etb"], "chaos rising"),
    item("z", ["etb"], null),
  ];
  const plan = planTagMerges(items);

  it("renames the old tag in place, for linked and unlinked items alike", () => {
    const r = applyTagMerge(items, plan, new Set(["mega2.5"]), false);
    const get = (id: string) => r.changes.find((c) => c.id === id)?.after;
    expect(get("a")).toEqual(["ascended heroes", "etb"]);
    expect(get("c")).toEqual(["ascended heroes"]);
    expect(get("d")).toBeUndefined(); // untouched
    expect(r.renamed).toBe(2);
    expect(r.added).toBe(0);
  });
  it("changes nothing when nothing is chosen", () => {
    const r = applyTagMerge(items, plan, new Set(), false);
    expect(r.changes).toEqual([]);
  });
  it("can also give every other linked item its set tag", () => {
    const r = applyTagMerge(items, plan, new Set(["mega2.5"]), true);
    expect(r.changes.find((c) => c.id === "d")?.after).toEqual(["etb", "chaos rising"]);
    expect(r.changes.find((c) => c.id === "z")).toBeUndefined(); // no set known
    expect(r.added).toBe(1);
  });
  it("ignores tags that were never proposed, so a client cannot invent a rename", () => {
    const r = applyTagMerge(items, plan, new Set(["etb"]), false);
    expect(r.changes).toEqual([]);
  });
  it("does not duplicate when the item already has the set tag", () => {
    const own = [item("a", ["mega2.5", "ascended heroes"], "ascended heroes"), item("b", ["mega2.5"], "ascended heroes")];
    const r = applyTagMerge(own, planTagMerges(own), new Set(["mega2.5"]), false);
    expect(r.changes.find((c) => c.id === "a")?.after).toEqual(["ascended heroes"]);
  });
  it("never goes over the limit, and says how many items were full", () => {
    const full = Array.from({ length: MAX_TAGS_PER_ITEM }, (_, i) => `t${i}`);
    const r = applyTagMerge([item("a", full, "some set")], [], new Set(), true);
    expect(r.changes).toEqual([]);
    expect(r.full).toBe(1);
  });
  it("is stable: applying twice changes nothing the second time", () => {
    const once = applyTagMerge(items, plan, new Set(["mega2.5"]), true);
    const next = items.map((it) => ({ ...it, tags: once.changes.find((c) => c.id === it.id)?.after ?? it.tags }));
    const again = applyTagMerge(next, planTagMerges(next), new Set(["mega2.5"]), true);
    expect(again.changes).toEqual([]);
  });
});

describe("looksLikeProduct", () => {
  it("spots product words anywhere in a tag", () => {
    for (const t of ["etb", "jp box", "etb center", "booster box", "build-battle", "tin", "slab", "psa10", "Case"]) {
      expect(looksLikeProduct(t), t).toBe(t !== "psa10");
    }
  });
  it("does not mistake set tags for products", () => {
    for (const t of ["mega2.5", "pris", "surging", "black", "white", "30th", "destinedrivals", "evolving skies", "gar", "cz"]) {
      expect(looksLikeProduct(t), t).toBe(false);
    }
  });
});
