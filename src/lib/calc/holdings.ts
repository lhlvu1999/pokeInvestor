import type { Transaction } from "@/db/schema";

export type HoldingsSnapshot = {
  /** Total units currently held (received, not yet sold). */
  quantity: number;
  /** Weighted-average cost per held unit (display only; in minor units). */
  avgCostCents: number;
  /** Total realized profit (minor units) across closed lots + FIFO sells. */
  realizedProfitCents: number;
  /** Total quantity sold across the lifetime. */
  soldQuantity: number;
  /** Lifetime cost of all buys, including pending (informational). */
  totalBoughtCents: number;
  /** Lifetime received from all sells (informational). */
  totalSoldCents: number;
  /** Units bought but not yet received (paid, in transit). */
  pendingQuantity: number;
  /** Money committed to pending buys (already in totalBoughtCents). */
  pendingCostCents: number;
  /** Lifetime shipping recorded against buys (minor units). */
  totalShippingCents: number;
  /** ISO 4217 currency code of all amounts above. Empty string if no transactions. */
  currency: string;
};

export const EMPTY_HOLDINGS: HoldingsSnapshot = {
  quantity: 0,
  avgCostCents: 0,
  realizedProfitCents: 0,
  soldQuantity: 0,
  totalBoughtCents: 0,
  totalSoldCents: 0,
  pendingQuantity: 0,
  pendingCostCents: 0,
  totalShippingCents: 0,
  currency: "",
};

export class InsufficientHoldingsError extends Error {
  constructor(public sellQty: number, public heldQty: number) {
    super(
      `Cannot sell ${sellQty} unit(s); only ${heldQty} held at the time of this transaction.`,
    );
    this.name = "InsufficientHoldingsError";
  }
}

export class MixedCurrencyError extends Error {
  constructor(public expected: string, public got: string) {
    super(
      `All transactions of one item must share a currency. Expected ${expected}, got ${got}.`,
    );
    this.name = "MixedCurrencyError";
  }
}

type TxInput = Pick<
  Transaction,
  | "type"
  | "quantity"
  | "finalValueCents"
  | "occurredAt"
  | "currency"
  | "lotId"
  | "status"
  | "shippingCents"
>;

type InventoryEntry = {
  qty: number;
  cost: number;
  lotId: string | null;
};

/**
 * Replay transactions chronologically into a single inventory queue.
 *
 * - **Lot-specific sells** (`tx.lotId != null`) consume only from queue
 *   entries with the same lotId (preserves per-row realized profit from
 *   imported lot pairs).
 * - **Manual sells** (`tx.lotId == null`) consume FIFO from the oldest
 *   available units regardless of lot — so a manual sell can draw from
 *   leftover open-lot inventory.
 *
 * Returns the per-sell realized records plus the final queue. Used by both
 * `computeHoldings` and `replayItemEvents` (cashflow).
 */
function replayInventory(sorted: ReadonlyArray<TxInput>): {
  queue: InventoryEntry[];
  events: { sellTx: TxInput; consumed: number }[];
  realized: number;
  totalBought: number;
  totalSold: number;
  soldQty: number;
  pendingQty: number;
  pendingCost: number;
  totalShipping: number;
} {
  const queue: InventoryEntry[] = [];
  const events: { sellTx: TxInput; consumed: number }[] = [];
  let realized = 0;
  let totalBought = 0;
  let totalSold = 0;
  let soldQty = 0;
  let pendingQty = 0;
  let pendingCost = 0;
  let totalShipping = 0;

  function consumeOne(
    entry: InventoryEntry,
    take: number,
  ): number {
    const cost =
      take === entry.qty
        ? entry.cost
        : Math.round((entry.cost * take) / entry.qty);
    entry.qty -= take;
    entry.cost -= cost;
    return cost;
  }

  for (const tx of sorted) {
    if (tx.type === "buy") {
      // Money is committed whether or not the goods have arrived.
      totalBought += tx.finalValueCents;
      if (tx.shippingCents) totalShipping += tx.shippingCents;
      if (tx.status === "pending") {
        pendingQty += tx.quantity;
        pendingCost += tx.finalValueCents;
        continue;
      }
      queue.push({
        qty: tx.quantity,
        cost: tx.finalValueCents,
        lotId: tx.lotId,
      });
      continue;
    }
    // Sell
    let toSell = tx.quantity;
    let consumed = 0;
    for (const entry of queue) {
      if (toSell === 0) break;
      if (entry.qty === 0) continue;
      // Lot sells: only matching lotId entries. Manual sells: any entry.
      if (tx.lotId != null && entry.lotId !== tx.lotId) continue;
      const take = Math.min(toSell, entry.qty);
      consumed += consumeOne(entry, take);
      toSell -= take;
    }
    if (toSell > 0) {
      // Report "available" relative to what this sell could legally consume.
      const stillHeld =
        tx.lotId != null
          ? queue
              .filter((e) => e.lotId === tx.lotId)
              .reduce((s, e) => s + e.qty, 0)
          : queue.reduce((s, e) => s + e.qty, 0);
      throw new InsufficientHoldingsError(tx.quantity, stillHeld);
    }
    realized += tx.finalValueCents - consumed;
    totalSold += tx.finalValueCents;
    soldQty += tx.quantity;
    if (tx.shippingCents) totalShipping += tx.shippingCents;
    events.push({ sellTx: tx, consumed });
  }

  return {
    queue,
    events,
    realized,
    totalBought,
    totalSold,
    soldQty,
    pendingQty,
    pendingCost,
    totalShipping,
  };
}

/**
 * Compute current holdings using a unified inventory queue:
 *   - Sells with a `lotId` consume only from their own lot's buys
 *     (specific-lot accounting — per-row realized for imported pairs).
 *   - Sells without a `lotId` consume FIFO across **any** inventory, so
 *     manual sells can draw from leftover open-lot units.
 *
 * Throws:
 *   - MixedCurrencyError when transactions span multiple currencies.
 *   - InsufficientHoldingsError when a sell can't be satisfied.
 */
export function computeHoldings(
  transactions: ReadonlyArray<TxInput>,
): HoldingsSnapshot {
  if (transactions.length === 0) return EMPTY_HOLDINGS;

  const sorted = [...transactions].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  const currency = sorted[0].currency;
  for (const tx of sorted) {
    if (tx.currency !== currency) {
      throw new MixedCurrencyError(currency, tx.currency);
    }
    if (tx.quantity <= 0) {
      throw new Error("Transaction quantity must be positive");
    }
  }

  const result = replayInventory(sorted);

  const heldQty = result.queue.reduce((s, e) => s + e.qty, 0);
  const heldCost = result.queue.reduce((s, e) => s + e.cost, 0);

  return {
    quantity: heldQty,
    avgCostCents: heldQty === 0 ? 0 : Math.round(heldCost / heldQty),
    realizedProfitCents: result.realized,
    soldQuantity: result.soldQty,
    totalBoughtCents: result.totalBought,
    totalSoldCents: result.totalSold,
    pendingQuantity: result.pendingQty,
    pendingCostCents: result.pendingCost,
    totalShippingCents: result.totalShipping,
    currency,
  };
}

export type ItemValuation = HoldingsSnapshot & {
  marketPriceCents: number | null;
  inventoryCostCents: number;
  marketValueCents: number;
  unrealizedProfitCents: number;
  totalProfitCents: number;
};

export function valueHoldings(
  snapshot: HoldingsSnapshot,
  marketPriceCents: number | null,
): ItemValuation {
  const inventoryCostCents = snapshot.quantity * snapshot.avgCostCents;
  const marketValueCents =
    marketPriceCents == null ? 0 : snapshot.quantity * marketPriceCents;
  const unrealizedProfitCents =
    marketPriceCents == null ? 0 : marketValueCents - inventoryCostCents;
  return {
    ...snapshot,
    marketPriceCents,
    inventoryCostCents,
    marketValueCents,
    unrealizedProfitCents,
    totalProfitCents: snapshot.realizedProfitCents + unrealizedProfitCents,
  };
}
