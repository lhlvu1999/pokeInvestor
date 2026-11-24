/**
 * Entries worth a second look. None of these are errors the app can be sure
 * of, so each one says what it noticed and what to do if it was a slip.
 *
 * The one that matters most: a sale for nothing that was never marked as a
 * gift, a loss or an opened pack. It is counted as a sale, so it drags down the
 * win rate and margin (the profit total is right either way).
 */

export type CheckKind = "free_sale" | "free_buy" | "future";

export type CheckTx = {
  id: string;
  itemId: string;
  itemName: string;
  type: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  occurredAt: Date;
  /** Stored reason: null for a normal sale. */
  exitReason: string | null;
};

export type Finding = {
  kind: CheckKind;
  txId: string;
  itemId: string;
  itemName: string;
  occurredAt: Date;
  quantity: number;
  title: string;
  advice: string;
};

/** A date this far ahead is a typo, not a plan. */
export const FUTURE_GRACE_DAYS = 1;

const DAY = 24 * 60 * 60 * 1000;

export function findDataIssues(txs: readonly CheckTx[], now: Date): Finding[] {
  const out: Finding[] = [];
  for (const t of txs) {
    const base = {
      txId: t.id,
      itemId: t.itemId,
      itemName: t.itemName,
      occurredAt: t.occurredAt,
      quantity: t.quantity,
    };
    if (t.occurredAt.getTime() > now.getTime() + FUTURE_GRACE_DAYS * DAY) {
      out.push({
        ...base,
        kind: "future",
        title: `Dated in the future`,
        advice:
          "Check the date. A transaction that has not happened yet is counted in your holdings and returns as if it had.",
      });
    }
    if (t.type === "sell" && t.finalValueCents === 0 && t.exitReason == null) {
      out.push({
        ...base,
        kind: "free_sale",
        title: "Logged as a sale for nothing",
        advice:
          "If it was given away, lost or opened, change why it left. Then it stops counting as a losing sale.",
      });
    }
    if (t.type === "buy" && t.finalValueCents === 0) {
      out.push({
        ...base,
        kind: "free_buy",
        title: "Bought for nothing",
        advice:
          "Fine for a gift or a freebie. If the price was left out, any sale of it will show as pure profit.",
      });
    }
  }
  const rank: Record<CheckKind, number> = { future: 0, free_sale: 1, free_buy: 2 };
  return out.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      b.occurredAt.getTime() - a.occurredAt.getTime(),
  );
}

export function countByKind(findings: readonly Finding[]) {
  const n: Record<CheckKind, number> = { future: 0, free_sale: 0, free_buy: 0 };
  for (const f of findings) n[f.kind] += 1;
  return n;
}

/** Most entries one bulk change may touch, so a slip can't rewrite a ledger. */
export const MAX_BULK_REASON = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why a bulk "mark as gifted / lost / opened" request is not acceptable, if so. */
export function bulkReasonError(
  ids: readonly string[],
  reason: string,
): string | null {
  if (reason !== "gifted" && reason !== "lost" && reason !== "opened") {
    return "Choose gifted, lost or opened.";
  }
  if (ids.length === 0) return "Choose at least one entry.";
  if (ids.length > MAX_BULK_REASON) {
    return `Change at most ${MAX_BULK_REASON} entries at a time.`;
  }
  if (!ids.every((id) => UUID_RE.test(id))) return "One of the entries is invalid.";
  if (new Set(ids).size !== ids.length) return "An entry was chosen twice.";
  return null;
}
