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
  constructor(
    public sellQty: number,
    public heldQty: number,
  ) {
    super(
      `Cannot sell ${sellQty} unit(s); only ${heldQty} held at the time of this transaction.`,
    );
    this.name = "InsufficientHoldingsError";
  }
}

export class MixedCurrencyError extends Error {
  constructor(
    public expected: string,
    public got: string,
  ) {
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

/**
 * How sells are matched against purchases to decide what a sold unit cost.
 *
 * - `fifo`: specific-lot where a sell names its lot, otherwise oldest units
 *   first. Realized profit reflects the actual units that left.
 * - `average`: every held unit costs the pool's average (moving average),
 *   regardless of which purchase it came from. Smoother, and what many
 *   tax regimes and trackers use.
 *
 * The method only changes how profit is SPLIT between realized and
 * unrealized. Total profit (realized + unrealized) is identical under both.
 */
export type CostMethod = "fifo" | "average";

export const DEFAULT_COST_METHOD: CostMethod = "fifo";

export function isCostMethod(v: unknown): v is CostMethod {
  return v === "fifo" || v === "average";
}

/** Anything shaped like an inventory queue entry (analytics adds dates). */
export type QueueLike = { qty: number; cost: number; lotId: string | null };

/**
 * Remove `qty` units from `queue` (mutating it) and return the cost basis
 * of the units that left, plus how many units could not be found.
 *
 * `onTake` is called once per entry units are removed from, oldest first —
 * the analytics replay uses it to measure holding periods.
 */
export function consumeQueue<E extends QueueLike>(
  queue: E[],
  qty: number,
  lotId: string | null,
  method: CostMethod,
  onTake?: (entry: E, take: number) => void,
): { consumed: number; shortBy: number } {
  let toSell = qty;
  let consumed = 0;

  if (method === "average") {
    // Pool everything: a lot-specific sell has no special meaning here.
    let poolQty = 0;
    let poolCost = 0;
    for (const e of queue) {
      poolQty += e.qty;
      poolCost += e.cost;
    }
    const take = Math.min(qty, poolQty);
    if (take <= 0) return { consumed: 0, shortBy: qty };
    consumed =
      take === poolQty ? poolCost : Math.round((poolCost * take) / poolQty);

    // Remove units oldest-first (for `onTake`), then re-spread what is left
    // so every remaining unit carries the same average cost. The last
    // entry takes the rounding residue so the totals stay exact integers.
    let left = take;
    for (const e of queue) {
      if (left === 0) break;
      if (e.qty === 0) continue;
      const t = Math.min(left, e.qty);
      onTake?.(e, t);
      e.qty -= t;
      left -= t;
    }
    let remQty = poolQty - take;
    let remCost = poolCost - consumed;
    for (const e of queue) {
      if (e.qty === 0) {
        e.cost = 0;
        continue;
      }
      const share =
        e.qty === remQty ? remCost : Math.round((remCost * e.qty) / remQty);
      e.cost = share;
      remCost -= share;
      remQty -= e.qty;
    }
    return { consumed, shortBy: qty - take };
  }

  for (const entry of queue) {
    if (toSell === 0) break;
    if (entry.qty === 0) continue;
    // Lot sells: only matching lotId entries. Manual sells: any entry.
    if (lotId != null && entry.lotId !== lotId) continue;
    const take = Math.min(toSell, entry.qty);
    const cost =
      take === entry.qty
        ? entry.cost
        : Math.round((entry.cost * take) / entry.qty);
    onTake?.(entry, take);
    entry.qty -= take;
    entry.cost -= cost;
    consumed += cost;
    toSell -= take;
  }
  return { consumed, shortBy: toSell };
}

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
function replayInventory(
  sorted: ReadonlyArray<TxInput>,
  method: CostMethod,
): {
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
    // Sell. Count what this sell could legally draw on BEFORE consuming:
    // consumption removes units from the queue, so counting afterwards
    // would report a shortfall as "0 held" when some units were there.
    const available =
      tx.lotId != null && method === "fifo"
        ? queue
            .filter((e) => e.lotId === tx.lotId)
            .reduce((sum, e) => sum + e.qty, 0)
        : queue.reduce((sum, e) => sum + e.qty, 0);
    const { consumed, shortBy } = consumeQueue(
      queue,
      tx.quantity,
      tx.lotId,
      method,
    );
    if (shortBy > 0) {
      throw new InsufficientHoldingsError(tx.quantity, available);
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
  method: CostMethod = DEFAULT_COST_METHOD,
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

  const result = replayInventory(sorted, method);

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
