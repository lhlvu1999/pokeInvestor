import { describe, expect, it } from "vitest";
import {
  FAILING_CHUNKS_BEFORE_STOP,
  runRefresh,
  runSucceeded,
  withCooledDown,
  type ChunkResult,
  type RefreshOutcome,
  type RunOptions,
} from "./refresh_run";

const targets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));
const out = (status: RefreshOutcome["status"], i = 0, message?: string): RefreshOutcome => ({
  itemName: `Item ${i}`,
  status,
  message,
});
const opts = (over: Partial<RunOptions> = {}): RunOptions => {
  let t = 0;
  return { chunkSize: 3, budgetMs: 1000, maxItems: 100, now: () => (t += 1), ...over };
};

describe("runRefresh", () => {
  it("covers every item in chunks and counts each outcome", async () => {
    const calls: string[][] = [];
    const sum = await runRefresh(
      targets(7),
      async (ids): Promise<ChunkResult> => {
        calls.push(ids);
        return { ok: true, data: ids.map((_, i) => out(i === 0 ? "skipped" : "saved", i)) };
      },
      opts(),
    );
    expect(calls.map((c) => c.length)).toEqual([3, 3, 1]);
    expect(sum).toMatchObject({ considered: 7, attempted: 7, saved: 4, skipped: 3, stopped: null });
    expect(runSucceeded(sum)).toBe(true);
  });

  it("separates no-data, cooldown and errors, and remembers the first error", async () => {
    const sum = await runRefresh(
      targets(5),
      async (ids) => ({
        ok: true,
        data: ids.map((_, i) => [out("no_data"), out("cooldown"), out("error", 2, "boom"), out("error", 3, "later"), out("saved")][i % 5]),
      }),
      opts({ chunkSize: 5 }),
    );
    expect(sum).toMatchObject({ noData: 1, cooldown: 1, errors: 2, saved: 1, firstError: "boom" });
  });

  it("lists only the items that need attention, and at most 20", async () => {
    const sum = await runRefresh(
      targets(60),
      async (ids) => ({ ok: true, data: ids.map((_, i) => out(i % 2 ? "saved" : "no_data", i)) }),
      opts({ chunkSize: 10 }),
    );
    expect(sum.problems).toHaveLength(20);
    expect(sum.problems.every((p) => p.status === "no_data")).toBe(true);
  });

  it("stops at the item limit and says so", async () => {
    const calls: string[][] = [];
    const sum = await runRefresh(
      targets(10),
      async (ids) => (calls.push(ids), { ok: true, data: ids.map(() => out("saved")) }),
      opts({ maxItems: 4 }),
    );
    expect(sum).toMatchObject({ considered: 10, attempted: 4, stopped: "limit" });
    expect(runSucceeded(sum)).toBe(true);
  });

  it("stops starting new chunks once the time budget is used", async () => {
    let t = 0;
    const sum = await runRefresh(
      targets(30),
      async (ids) => {
        t += 400;
        return { ok: true, data: ids.map(() => out("saved")) };
      },
      { chunkSize: 5, budgetMs: 1000, maxItems: 100, now: () => t },
    );
    expect(sum.stopped).toBe("budget");
    expect(sum.attempted).toBe(15); // chunks at 0, 400, 800 ms; the fourth would start at 1200
    expect(runSucceeded(sum)).toBe(true);
  });

  it("gives up after repeated chunks where everything failed, instead of hammering eBay", async () => {
    let calls = 0;
    const sum = await runRefresh(
      targets(100),
      async (ids) => (calls++, { ok: true, data: ids.map(() => out("error", 0, "HTTP 401")) }),
      opts(),
    );
    expect(calls).toBe(FAILING_CHUNKS_BEFORE_STOP);
    expect(sum.stopped).toBe("failing");
    expect(sum.firstError).toBe("HTTP 401");
    expect(runSucceeded(sum)).toBe(false);
  });

  it("does not give up when failures are mixed with successes", async () => {
    let calls = 0;
    const sum = await runRefresh(
      targets(12),
      async (ids) => (calls++, { ok: true, data: ids.map((_, i) => out(i === 0 ? "error" : "saved")) }),
      opts(),
    );
    expect(calls).toBe(4);
    expect(sum.stopped).toBeNull();
  });

  it("a streak of failures is broken by one good chunk", async () => {
    const plan = ["error", "saved", "error", "saved"];
    let n = 0;
    const sum = await runRefresh(
      targets(12),
      async (ids) => ({ ok: true, data: ids.map(() => out(plan[n++] as RefreshOutcome["status"])) }),
      opts({ chunkSize: 1, maxItems: 4 }),
    );
    expect(sum.stopped).toBe("limit"); // all 4 ran; never two failing chunks in a row
    expect(sum.attempted).toBe(4);
  });

  it("stops and reports when a whole chunk cannot be processed", async () => {
    const sum = await runRefresh(targets(9), async () => ({ ok: false, error: "database down" }), opts());
    expect(sum).toMatchObject({ attempted: 0, stopped: "error", firstError: "database down" });
    expect(runSucceeded(sum)).toBe(false);
  });

  it("does nothing, successfully, when there is nothing to do", async () => {
    const sum = await runRefresh([], async () => ({ ok: true, data: [] }), opts());
    expect(sum).toMatchObject({ considered: 0, attempted: 0, stopped: null });
    expect(runSucceeded(sum)).toBe(true);
  });
});

describe("withCooledDown", () => {
  it("adds recently priced items to what was considered and to the cooldown count", async () => {
    const base = await runRefresh(targets(3), async (ids) => ({ ok: true, data: ids.map(() => out("saved")) }), opts());
    const s = withCooledDown(base, 5);
    expect(s).toMatchObject({ considered: 8, attempted: 3, saved: 3, cooldown: 5 });
    // The three numbers add up to everything held.
    expect(s.saved + s.skipped + s.noData + s.errors + s.cooldown).toBe(s.considered);
  });
  it("leaves the rest of the summary alone", async () => {
    const base = await runRefresh([], async () => ({ ok: true, data: [] }), opts());
    expect(withCooledDown(base, 0)).toEqual(base);
  });
});
