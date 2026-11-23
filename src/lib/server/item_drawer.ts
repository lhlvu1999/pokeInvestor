import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import type { DrawerPoint, DrawerTrade } from "@/lib/calc/item_drawer";
import { getItemDetail } from "./items";
import { getItemPriceHistory } from "./price_analytics";
import { getDisplayCurrency } from "./settings";

/**
 * Everything the item drawer shows, already in the display currency and
 * with plain-number timestamps so it serialises straight to JSON.
 */
export type ItemDrawerData = {
  id: string;
  name: string;
  imageUrl: string | null;
  tags: string[];
  currency: string;
  held: number;
  pending: number;
  avgCost: number;
  inventoryCost: number;
  /** Null when the item has never been priced. */
  marketPrice: number | null;
  marketValue: number;
  unrealized: number;
  realized: number;
  /** Epoch ms of the newest price snapshot, if any. */
  lastPricedAt: number | null;
  points: DrawerPoint[];
  trades: DrawerTrade[];
  recent: {
    id: string;
    t: number;
    type: "buy" | "sell";
    qty: number;
    total: number;
    pending: boolean;
  }[];
};

const RECENT_LIMIT = 5;

export async function getItemDrawerData(
  id: string,
): Promise<ItemDrawerData | null> {
  const [detail, history, displayCurrency] = await Promise.all([
    getItemDetail(id),
    getItemPriceHistory(id),
    getDisplayCurrency(),
  ]);
  if (!detail) return null;

  const { item, valuation, latestPrice, transactions } = detail;
  const native = valuation.currency || history.currency || displayCurrency;

  // One rate per item: all of an item's amounts share a currency.
  let convert = (m: number) => m;
  if (native !== displayCurrency) {
    try {
      const { rate } = await getRate(
        native as CurrencyCode,
        displayCurrency as CurrencyCode,
      );
      convert = (m: number) => convertMinor(m, native, displayCurrency, rate);
    } catch {
      // No rate available: show native amounts and say so via `currency`.
      return build(
        item,
        valuation,
        latestPrice,
        transactions,
        history,
        native,
        (m) => m,
      );
    }
  }
  return build(
    item,
    valuation,
    latestPrice,
    transactions,
    history,
    displayCurrency,
    convert,
  );
}

type Detail = NonNullable<Awaited<ReturnType<typeof getItemDetail>>>;

function build(
  item: Detail["item"],
  valuation: Detail["valuation"],
  latestPrice: Detail["latestPrice"],
  transactions: Detail["transactions"],
  history: Awaited<ReturnType<typeof getItemPriceHistory>>,
  currency: string,
  convert: (m: number) => number,
): ItemDrawerData {
  const trades: DrawerTrade[] = [];
  for (const t of transactions) {
    if (t.quantity <= 0) continue;
    // Buys: per-unit item cost, excluding shipping (the chart compares it
    // with the market price, which has no shipping in it). Sells: net.
    const total =
      t.type === "buy"
        ? t.finalValueCents - (t.shippingCents ?? 0)
        : t.finalValueCents;
    if (total <= 0) continue;
    trades.push({
      t: t.occurredAt.getTime(),
      type: t.type,
      qty: t.quantity,
      unit: convert(Math.round(total / t.quantity)),
    });
  }

  const recent = [...transactions]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, RECENT_LIMIT)
    .map((t) => ({
      id: t.id,
      t: t.occurredAt.getTime(),
      type: t.type,
      qty: t.quantity,
      total: convert(t.finalValueCents),
      pending: t.status === "pending",
    }));

  const hasPrice = latestPrice != null;
  return {
    id: item.id,
    name: item.name,
    imageUrl: item.imageUrl,
    tags: item.tags,
    currency,
    held: valuation.quantity,
    pending: valuation.pendingQuantity,
    avgCost: convert(valuation.avgCostCents),
    inventoryCost: convert(valuation.inventoryCostCents),
    marketPrice: hasPrice ? convert(latestPrice.priceCents) : null,
    marketValue: convert(valuation.marketValueCents),
    unrealized: convert(valuation.unrealizedProfitCents),
    realized: convert(valuation.realizedProfitCents),
    lastPricedAt: hasPrice ? latestPrice.fetchedAt.getTime() : null,
    points: history.points.map((p) => ({
      t: p.fetchedAt.getTime(),
      price: convert(p.priceCents),
    })),
    trades,
    recent,
  };
}
