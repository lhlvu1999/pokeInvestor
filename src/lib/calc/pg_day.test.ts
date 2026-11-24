import { describe, expect, it } from "vitest";
import { utcDay } from "./pg_day";

describe("utcDay", () => {
  it("reads a timestamp string as that calendar day at midnight UTC", () => {
    expect(utcDay("2026-11-22 00:00:00")?.toISOString()).toBe(
      "2026-11-22T00:00:00.000Z",
    );
  });

  it("is the same day whatever the machine's time zone is", () => {
    // The point of the helper: local-time parsing would move this by hours.
    const d = utcDay("2026-01-01 00:00:00")!;
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]).toEqual([
      2026, 0, 1,
    ]);
  });

  it("accepts a bare date and an ISO timestamp", () => {
    expect(utcDay("2026-03-05")?.toISOString()).toBe(
      "2026-03-05T00:00:00.000Z",
    );
    expect(utcDay("2026-03-05T17:30:00Z")?.toISOString()).toBe(
      "2026-03-05T00:00:00.000Z",
    );
  });

  it("passes a real Date through", () => {
    const d = new Date("2026-06-01T12:00:00Z");
    expect(utcDay(d)).toBe(d);
  });

  it("returns null for missing or unreadable values", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "soon",
      20261122,
      {},
      new Date("x"),
    ]) {
      expect(utcDay(bad)).toBeNull();
    }
  });

  it("rejects dates that don't exist", () => {
    expect(utcDay("2026-02-31 00:00:00")).toBeNull();
    expect(utcDay("2026-13-01")).toBeNull();
  });
});
