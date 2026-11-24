import { describe, expect, it } from "vitest";
import {
  bulkReasonError,
  countByKind,
  findDataIssues,
  type CheckTx,
} from "./data_checks";

const now = new Date("2026-11-24T00:00:00Z");
let n = 0;
const tx = (o: Partial<CheckTx>): CheckTx => ({
  id: `t${n++}`,
  itemId: "i",
  itemName: "Box",
  type: "sell",
  quantity: 1,
  finalValueCents: 1000,
  occurredAt: new Date("2026-11-01T00:00:00Z"),
  exitReason: null,
  ...o,
});

describe("findDataIssues", () => {
  it("is quiet for ordinary entries", () => {
    expect(
      findDataIssues([tx({}), tx({ type: "buy", finalValueCents: 500 })], now),
    ).toEqual([]);
  });

  it("flags an untagged sale for nothing, but not a tagged one", () => {
    const f = findDataIssues(
      [
        tx({ finalValueCents: 0 }),
        tx({ finalValueCents: 0, exitReason: "gifted" }),
      ],
      now,
    );
    expect(f.map((x) => x.kind)).toEqual(["free_sale"]);
  });

  it("flags a free buy as the softest finding", () => {
    const f = findDataIssues(
      [tx({ type: "buy", finalValueCents: 0 }), tx({ finalValueCents: 0 })],
      now,
    );
    expect(f.map((x) => x.kind)).toEqual(["free_sale", "free_buy"]);
  });

  it("allows a day of slack for time zones, not more", () => {
    const ok = tx({ occurredAt: new Date("2026-11-24T20:00:00Z") });
    const bad = tx({ occurredAt: new Date("2026-11-26T00:00:00Z") });
    expect(findDataIssues([ok, bad], now).map((x) => x.txId)).toEqual([bad.id]);
  });

  it("orders by kind, then newest first", () => {
    const a = tx({ finalValueCents: 0, occurredAt: new Date("2026-02-01") });
    const b = tx({ finalValueCents: 0, occurredAt: new Date("2026-03-01") });
    const c = tx({ occurredAt: new Date("2027-01-01") });
    expect(findDataIssues([a, b, c], now).map((x) => x.txId)).toEqual([
      c.id,
      b.id,
      a.id,
    ]);
  });

  it("counts by kind", () => {
    const f = findDataIssues(
      [tx({ finalValueCents: 0 }), tx({ type: "buy", finalValueCents: 0 })],
      now,
    );
    expect(countByKind(f)).toEqual({ future: 0, free_sale: 1, free_buy: 1 });
  });
});

describe("bulkReasonError", () => {
  const id = "0b1f3c2e-1111-4222-8333-444455556666";
  it("accepts a write-off reason and valid distinct ids", () => {
    expect(bulkReasonError([id], "gifted")).toBeNull();
    expect(bulkReasonError([id], "lost")).toBeNull();
    expect(bulkReasonError([id], "opened")).toBeNull();
  });
  it("refuses 'sold', unknown reasons and empty lists", () => {
    expect(bulkReasonError([id], "sold")).not.toBeNull();
    expect(bulkReasonError([id], "xyz")).not.toBeNull();
    expect(bulkReasonError([], "lost")).not.toBeNull();
  });
  it("refuses bad, duplicate or too many ids", () => {
    expect(bulkReasonError(["nope"], "lost")).not.toBeNull();
    expect(bulkReasonError([id, id], "lost")).not.toBeNull();
    const many = Array.from(
      { length: 101 },
      (_, i) => `0b1f3c2e-1111-4222-8333-${String(i).padStart(12, "0")}`,
    );
    expect(bulkReasonError(many, "lost")).not.toBeNull();
  });
});
