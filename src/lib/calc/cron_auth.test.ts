import { describe, expect, it } from "vitest";
import { MIN_CRON_TOKEN_LENGTH, bearerToken, readCronConfig } from "./cron_auth";

describe("readCronConfig", () => {
  it("is off when no token is set", () => {
    expect(readCronConfig({})).toEqual({ mode: "off" });
    expect(readCronConfig({ CRON_TOKEN: "" })).toEqual({ mode: "off" });
    expect(readCronConfig({ CRON_TOKEN: "   " })).toEqual({ mode: "off" });
  });
  it("is on with a long enough token", () => {
    const token = "a".repeat(MIN_CRON_TOKEN_LENGTH);
    expect(readCronConfig({ CRON_TOKEN: token })).toEqual({ mode: "on", token });
  });
  it("refuses a short token rather than running with a weak key", () => {
    expect(readCronConfig({ CRON_TOKEN: "a".repeat(MIN_CRON_TOKEN_LENGTH - 1) }).mode).toBe("broken");
    expect(readCronConfig({ CRON_TOKEN: "hunter2" }).mode).toBe("broken");
  });
});

describe("bearerToken", () => {
  it("reads a bearer header", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer abc123")).toBe("abc123");
    expect(bearerToken("  Bearer   abc123  ")).toBe("abc123");
  });
  it("is null for anything else", () => {
    for (const h of [null, undefined, "", "Basic abc", "Bearer", "Bearer a b", "abc123", "Bearer "]) {
      expect(bearerToken(h as string), String(h)).toBeNull();
    }
  });
});
