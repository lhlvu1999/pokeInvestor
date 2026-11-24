/**
 * Moving transactions to another date, safely.
 *
 * A date decides the order things happened in, and order decides what you
 * could sell: pull a sale earlier than the purchase that supplied it and the
 * history stops adding up. So a move is checked by replaying every affected
 * item's whole timeline with the new dates, and it is all-or-nothing: if any
 * item would break, nothing moves and the message says which one.
 */

import {
  InsufficientHoldingsError,
  MixedCurrencyError,
  computeHoldings,
} from "./holdings";
import type { Transaction } from "@/db/schema";

type Tx = Pick<
  Transaction,
  | "id"
  | "itemId"
  | "type"
  | "quantity"
  | "finalValueCents"
  | "occurredAt"
  | "currency"
  | "lotId"
  | "status"
  | "shippingCents"
>;

/** Earliest and latest dates a transaction may be given. */
export const MIN_DATE = new Date("2000-01-01T00:00:00Z");
const MAX_AHEAD_MS = 86_400_000;

export type DateMove = { id: string; occurredAt: Date };

export type MoveCheck =
  { ok: true; affectedItemIds: string[] } | { ok: false; error: string };

/**
 * Check a batch of moves against the full set of transactions. `all` must
 * contain every transaction of every item touched by `moves` (extra items
 * are ignored). Unknown ids are an error, not silently skipped.
 */
export function checkDateMoves(
  all: ReadonlyArray<Tx>,
  moves: ReadonlyArray<DateMove>,
  nameOf: (itemId: string) => string,
  now: Date,
): MoveCheck {
  if (moves.length === 0) return { ok: false, error: "Nothing selected." };

  const target = new Map<string, Date>();
  for (const m of moves) {
    if (Number.isNaN(m.occurredAt.getTime())) {
      return { ok: false, error: "That isn't a valid date." };
    }
    if (m.occurredAt < MIN_DATE) {
      return { ok: false, error: "That date is too far in the past." };
    }
    if (m.occurredAt.getTime() > now.getTime() + MAX_AHEAD_MS) {
      return { ok: false, error: "That date is in the future." };
    }
    target.set(m.id, m.occurredAt);
  }

  const byId = new Map(all.map((t) => [t.id, t]));
  for (const id of target.keys()) {
    if (!byId.has(id)) {
      return { ok: false, error: "A selected transaction no longer exists." };
    }
  }

  const itemIds = Array.from(
    new Set(Array.from(target.keys()).map((id) => byId.get(id)!.itemId)),
  );
  for (const itemId of itemIds) {
    const candidate = all
      .filter((t) => t.itemId === itemId)
      .map((t) =>
        target.has(t.id) ? { ...t, occurredAt: target.get(t.id)! } : t,
      );
    try {
      computeHoldings(candidate);
    } catch (err) {
      if (
        err instanceof InsufficientHoldingsError ||
        err instanceof MixedCurrencyError
      ) {
        return { ok: false, error: `${nameOf(itemId)}: ${err.message}` };
      }
      throw err;
    }
  }
  return { ok: true, affectedItemIds: itemIds };
}
