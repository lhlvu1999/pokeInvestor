import { describe, expect, it } from "vitest";
import { cachedAsync } from "./cached";

describe("cachedAsync", () => {
  it("computes once within the ttl and again after it", async () => {
    let t = 0;
    let runs = 0;
    const get = cachedAsync(
      async () => ++runs,
      1000,
      () => t,
    );
    expect(await get()).toBe(1);
    t = 999;
    expect(await get()).toBe(1);
    t = 1000;
    expect(await get()).toBe(2);
    expect(runs).toBe(2);
  });

  it("shares one running computation between simultaneous askers", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const get = cachedAsync(async () => {
      runs++;
      await gate;
      return "done";
    }, 1000);
    const all = Promise.all([get(), get(), get()]);
    release();
    expect(await all).toEqual(["done", "done", "done"]);
    expect(runs).toBe(1);
  });

  it("does not remember a failure", async () => {
    let runs = 0;
    const get = cachedAsync(async () => {
      runs++;
      if (runs === 1) throw new Error("down");
      return "ok";
    }, 1000);
    await expect(get()).rejects.toThrow("down");
    expect(await get()).toBe("ok");
    expect(runs).toBe(2);
  });
});
