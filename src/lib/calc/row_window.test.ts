import { describe, expect, it } from "vitest";
import { rowWindow, windowLabel } from "./row_window";

describe("rowWindow", () => {
  it("shows everything when the list fits in one page", () => {
    expect(rowWindow(120, 300, 0)).toEqual({ shown: 120, total: 120, hasMore: false });
    expect(rowWindow(300, 300, 0)).toEqual({ shown: 300, total: 300, hasMore: false });
  });
  it("limits a long list to one page and says there is more", () => {
    expect(rowWindow(565, 300, 0)).toEqual({ shown: 300, total: 565, hasMore: true });
  });
  it("widens by whole pages and stops at the total", () => {
    expect(rowWindow(565, 300, 300)).toEqual({ shown: 565, total: 565, hasMore: false });
    expect(rowWindow(5000, 300, 600)).toEqual({ shown: 900, total: 5000, hasMore: true });
  });
  it("copes with an empty list and odd inputs", () => {
    expect(rowWindow(0, 300, 0)).toEqual({ shown: 0, total: 0, hasMore: false });
    expect(rowWindow(10, 0, -5)).toEqual({ shown: 1, total: 10, hasMore: true });
  });
});

describe("windowLabel", () => {
  it("is silent when nothing is hidden", () => {
    expect(windowLabel(rowWindow(50, 300, 0), "transactions")).toBeNull();
  });
  it("says how many of how many, with thousands separators", () => {
    expect(windowLabel(rowWindow(5650, 300, 0), "transactions")).toBe("Showing 300 of 5,650 transactions");
  });
});
