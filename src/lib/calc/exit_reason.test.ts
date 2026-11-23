import { describe, expect, it } from "vitest";
import {
  defaultsToZeroValue,
  displayExitReason,
  isExitReason,
  isSale,
  storedExitReason,
} from "./exit_reason";
import { computeHoldings } from "./holdings";
import { replayForAnalytics } from "./analytics";

describe("storedExitReason", () => {
  it("never stores a reason on a buy", () => {
    expect(storedExitReason("buy", "gifted")).toBeNull();
  });
  it("stores a sale as null", () => {
    expect(storedExitReason("sell", "sold")).toBeNull();
    expect(storedExitReason("sell", undefined)).toBeNull();
    expect(storedExitReason("sell", "")).toBeNull();
  });
  it("keeps real exit reasons", () => {
    expect(storedExitReason("sell", "gifted")).toBe("gifted");
    expect(storedExitReason("sell", "lost")).toBe("lost");
    expect(storedExitReason("sell", "opened")).toBe("opened");
  });
  it("ignores garbage", () => {
    expect(storedExitReason("sell", "stolen-by-aliens")).toBeNull();
  });
});

describe("displayExitReason / isSale", () => {
  it("treats null as a sale", () => {
    expect(displayExitReason(null)).toBe("sold");
    expect(isSale(null)).toBe(true);
    expect(isSale(undefined)).toBe(true);
    expect(isSale("sold")).toBe(true);
  });
  it("treats the others as exits", () => {
    expect(isSale("gifted")).toBe(false);
    expect(isSale("opened")).toBe(false);
  });
  it("recognizes valid values only", () => {
    expect(isExitReason("lost")).toBe(true);
    expect(isExitReason("nope")).toBe(false);
    expect(isExitReason(3)).toBe(false);
  });
});

describe("defaultsToZeroValue", () => {
  it("is true for gifts and losses only", () => {
    expect(defaultsToZeroValue("gifted")).toBe(true);
    expect(defaultsToZeroValue("lost")).toBe(true);
    expect(defaultsToZeroValue("opened")).toBe(false);
    expect(defaultsToZeroValue("sold")).toBe(false);
  });
});

describe("a write-off in the books", () => {
  const t = (n: number) => new Date(2026, 0, n);
  const buy = {
    id: "b",
    type: "buy" as const,
    quantity: 3,
    finalValueCents: 3000,
    occurredAt: t(1),
    currency: "VND",
    lotId: null,
    status: "received" as const,
    shippingCents: null,
  };
  const gift = {
    ...buy,
    id: "g",
    type: "sell" as const,
    quantity: 1,
    finalValueCents: 0,
    occurredAt: t(2),
  };

  it("realizes the cost as a loss and removes the unit", () => {
    const h = computeHoldings([buy, gift]);
    expect(h.quantity).toBe(2);
    expect(h.realizedProfitCents).toBe(-1000);
  });

  it("still shows up as an analytics sell, tagged so stats can skip it", () => {
    const { sells } = replayForAnalytics([
      buy,
      { ...gift, exitReason: "gifted" },
    ]);
    expect(sells).toHaveLength(1);
    expect(sells[0].exitReason).toBe("gifted");
    expect(sells[0].realizedCents).toBe(-1000);
  });
});
