import { describe, expect, it } from "vitest";
import {
  benchmarkLabel,
  chooseBenchmark,
  parseBenchMode,
} from "./benchmark";

const all = () => true;
const onlyEnAll = (m: string, l: string) => m === "sealed_all" && l === "en";

describe("parseBenchMode", () => {
  it("defaults to matching kind", () => {
    expect(parseBenchMode(undefined)).toBe("match");
    expect(parseBenchMode("all")).toBe("all");
    expect(parseBenchMode("nope")).toBe("match");
    expect(parseBenchMode(["all", "match"])).toBe("all");
  });
});

describe("chooseBenchmark", () => {
  it("matches the product's kind and language", () => {
    expect(chooseBenchmark("match", "etb", "en", all)).toEqual({
      metric: "etb",
      language: "en",
    });
    expect(chooseBenchmark("match", "box", "ja", all)).toEqual({
      metric: "box",
      language: "ja",
    });
  });

  it("uses all sealed when asked to", () => {
    expect(chooseBenchmark("all", "etb", "ja", all)).toEqual({
      metric: "sealed_all",
      language: "ja",
    });
  });

  it("falls back to all sealed when the kind has no index", () => {
    expect(chooseBenchmark("match", "etb", "en", onlyEnAll)).toEqual({
      metric: "sealed_all",
      language: "en",
    });
  });

  it("treats an unlinked or untracked product as English, all sealed", () => {
    expect(chooseBenchmark("match", null, null, all)).toEqual({
      metric: "sealed_all",
      language: "en",
    });
  });

  it("is null when nothing fits", () => {
    expect(chooseBenchmark("match", "box", "ja", () => false)).toBeNull();
  });
});

describe("benchmarkLabel", () => {
  it("names the index and its language", () => {
    expect(benchmarkLabel({ metric: "etb", language: "en" })).toBe(
      "Elite Trainer Boxes (English)",
    );
    expect(benchmarkLabel({ metric: "sealed_all", language: "ja" })).toBe(
      "All sealed (Japanese)",
    );
  });
});
