import { describe, expect, it } from "vitest";
import { checkDateMoves, type DateMove } from "./bulk_date";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const NOW = d("2026-06-01");

let n = 0;
function tx(
  itemId: string,
  type: "buy" | "sell",
  quantity: number,
  iso: string,
  extra: Record<string, unknown> = {},
) {
  n += 1;
  return {
    id: `t${n}`,
    itemId,
    type,
    quantity,
    finalValueCents: 100 * quantity,
    occurredAt: d(iso),
    currency: "VND",
    lotId: null,
    status: "received" as const,
    shippingCents: null,
    ...extra,
  };
}
const name = (id: string) => `Item ${id}`;

describe("checkDateMoves", () => {
  it("allows a move that keeps every sale after its purchase", () => {
    const b = tx("a", "buy", 5, "2026-01-01");
    const s = tx("a", "sell", 3, "2026-03-01");
    const r = checkDateMoves(
      [b, s],
      [{ id: s.id, occurredAt: d("2026-02-01") }],
      name,
      NOW,
    );
    expect(r).toEqual({ ok: true, affectedItemIds: ["a"] });
  });

  it("refuses to put a sale before the purchase that supplied it, naming the item", () => {
    const b = tx("a", "buy", 5, "2026-01-01");
    const s = tx("a", "sell", 3, "2026-03-01");
    const r = checkDateMoves(
      [b, s],
      [{ id: s.id, occurredAt: d("2025-12-01") }],
      name,
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("Item a");
      expect(r.error).toContain("Cannot sell 3");
    }
  });

  it("accepts moving a purchase and its sale together, in order", () => {
    const b = tx("a", "buy", 5, "2026-03-01");
    const s = tx("a", "sell", 3, "2026-04-01");
    const moves: DateMove[] = [
      { id: b.id, occurredAt: d("2025-11-01") },
      { id: s.id, occurredAt: d("2025-12-01") },
    ];
    expect(checkDateMoves([b, s], moves, name, NOW).ok).toBe(true);
  });

  it("is all-or-nothing across items: one broken item fails the batch", () => {
    const b1 = tx("a", "buy", 5, "2026-01-01");
    const s1 = tx("a", "sell", 3, "2026-03-01");
    const b2 = tx("b", "buy", 5, "2026-01-01");
    const s2 = tx("b", "sell", 3, "2026-03-01");
    const r = checkDateMoves(
      [b1, s1, b2, s2],
      [
        { id: s1.id, occurredAt: d("2026-02-01") }, // fine
        { id: s2.id, occurredAt: d("2025-01-01") }, // breaks item b
      ],
      name,
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Item b");
  });

  it("only reports items that actually move", () => {
    const b1 = tx("a", "buy", 5, "2026-01-01");
    const b2 = tx("b", "buy", 5, "2026-01-01");
    const r = checkDateMoves(
      [b1, b2],
      [{ id: b1.id, occurredAt: d("2026-01-05") }],
      name,
      NOW,
    );
    expect(r).toEqual({ ok: true, affectedItemIds: ["a"] });
  });

  it("rejects an empty selection, unknown ids and bad dates", () => {
    const b = tx("a", "buy", 1, "2026-01-01");
    expect(checkDateMoves([b], [], name, NOW).ok).toBe(false);
    expect(
      checkDateMoves(
        [b],
        [{ id: "nope", occurredAt: d("2026-01-02") }],
        name,
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      checkDateMoves(
        [b],
        [{ id: b.id, occurredAt: new Date("garbage") }],
        name,
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      checkDateMoves(
        [b],
        [{ id: b.id, occurredAt: d("1999-01-01") }],
        name,
        NOW,
      ).ok,
    ).toBe(false);
  });

  it("rejects dates in the future but allows today", () => {
    const b = tx("a", "buy", 1, "2026-01-01");
    expect(
      checkDateMoves(
        [b],
        [{ id: b.id, occurredAt: d("2026-07-01") }],
        name,
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      checkDateMoves([b], [{ id: b.id, occurredAt: NOW }], name, NOW).ok,
    ).toBe(true);
  });

  it("treats a pending buy like any other for ordering", () => {
    const b = tx("a", "buy", 5, "2026-01-01", { status: "pending" });
    const r = checkDateMoves(
      [b],
      [{ id: b.id, occurredAt: d("2026-02-01") }],
      name,
      NOW,
    );
    expect(r.ok).toBe(true);
  });
});
