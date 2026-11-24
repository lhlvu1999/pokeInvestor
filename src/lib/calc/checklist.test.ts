import { describe, expect, it } from "vitest";
import { buildChecklist, progress, type ChecklistInput } from "./checklist";

const clean: ChecklistInput = {
  backupDays: 2,
  freeSales: 0,
  unlinkedHeld: 0,
  unmatchedSlabs: 0,
  noPicture: 0,
  heldItems: 100,
  priceAgeHours: 5,
  config: { login: "on", ebay: true, cron: "on" },
};
const by = (items: ReturnType<typeof buildChecklist>, key: string) => items.find((i) => i.key === key)!;

describe("buildChecklist", () => {
  it("shows everything done when nothing needs you", () => {
    const items = buildChecklist(clean);
    expect(items.filter((i) => i.state === "todo")).toEqual([]);
    expect(progress(items)).toEqual({ done: 9, total: 9 });
  });

  it("puts what needs doing first", () => {
    const items = buildChecklist({ ...clean, freeSales: 10, backupDays: null });
    expect(items.slice(0, 2).map((i) => i.key).sort()).toEqual(["backup", "free-sales"]);
    expect(items.every((i, n) => n === 0 || ["todo", "ok", "info"].indexOf(items[n - 1].state) <= ["todo", "ok", "info"].indexOf(i.state))).toBe(true);
  });

  it("asks for a first backup, then a refresh once it is stale", () => {
    expect(by(buildChecklist({ ...clean, backupDays: null }), "backup")).toMatchObject({ state: "todo", title: "Download your first backup" });
    expect(by(buildChecklist({ ...clean, backupDays: 29 }), "backup").state).toBe("ok");
    expect(by(buildChecklist({ ...clean, backupDays: 30 }), "backup")).toMatchObject({ state: "todo", title: "Refresh your backup" });
    expect(by(buildChecklist({ ...clean, backupDays: 0 }), "backup").detail).toBe("Last backup today.");
  });

  it("counts with the right wording and links to where to fix it", () => {
    const items = buildChecklist({ ...clean, freeSales: 1, unlinkedHeld: 9, unmatchedSlabs: 12, noPicture: 28 });
    expect(by(items, "free-sales").title).toBe("Say why 1 sale for nothing left");
    expect(by(items, "link")).toMatchObject({ title: "Link 9 held products to the catalogue", href: "/catalog/links" });
    expect(by(items, "slabs")).toMatchObject({ title: "Pick the card for 12 slabs", href: "/analytics/slabs" });
    expect(by(items, "pictures").title).toBe("Add a picture to 28 items");
  });

  it("judges prices by their age, and says when there are none", () => {
    expect(by(buildChecklist({ ...clean, priceAgeHours: 47 }), "prices").state).toBe("ok");
    expect(by(buildChecklist({ ...clean, priceAgeHours: 48 }), "prices").state).toBe("todo");
    expect(by(buildChecklist({ ...clean, priceAgeHours: 96 }), "prices").detail).toContain("4 days old");
    expect(by(buildChecklist({ ...clean, priceAgeHours: null }), "prices").title).toBe("Fetch market prices");
  });

  it("treats settings by what they are: required, optional, or broken", () => {
    const off = buildChecklist({ ...clean, config: { login: "off", ebay: false, cron: "off" } });
    expect(by(off, "ebay").state).toBe("todo");
    expect(by(off, "cron").state).toBe("info");
    expect(by(off, "login").state).toBe("info");
    const broken = buildChecklist({ ...clean, config: { login: "broken", ebay: true, cron: "broken" } });
    expect(by(broken, "login").state).toBe("todo");
    expect(by(broken, "cron").state).toBe("todo");
  });

  it("always notes that alerts live in the pipeline, without counting it as a task", () => {
    const items = buildChecklist(clean);
    expect(by(items, "alerts").state).toBe("info");
    expect(items[items.length - 1].state).toBe("info");
  });
});

describe("progress", () => {
  it("counts done and total, ignoring the notes", () => {
    const items = buildChecklist({ ...clean, freeSales: 3, unlinkedHeld: 2, config: { login: "off", ebay: true, cron: "off" } });
    expect(progress(items)).toEqual({ done: 5, total: 7 });
  });
});
