/**
 * Loader for the dashboard's "What changed" panel. A pure read (no "use
 * server"), so it is not exposed as a client-callable action.
 *
 * All amounts leave here in the display currency and all times as epoch
 * milliseconds, so the result serialises straight to JSON.
 */

import { and, asc, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  items,
  marketPrices,
  transactions,
  watchlistItems,
  youtubeInsightMentions,
  youtubeInsights,
  youtubeVideos,
} from "@/db/schema";
import {
  pickMoversByImpact,
  summarizeActivity,
  summarizeValueChange,
  watchHits,
  windowBounds,
  type ActivityTx,
  type Activity,
  type ChangeWindow,
  type HeldInput,
  type Mover,
  type WatchHit,
  type WatchInput,
} from "@/lib/calc/changes";
import type { PricePoint } from "@/lib/calc/price_history";
import { convertMinor, type CurrencyCode } from "@/lib/currency";
import { getRate } from "@/lib/fx";
import { listItemsWithValuations } from "./items";
import { safe } from "./safe";

const TOP_MOVERS = 5;

export type MentionChange = {
  itemId: string;
  name: string;
  bullish: number;
  bearish: number;
  /** In stock now, as opposed to only on the watchlist. */
  held: boolean;
};

export type ChangesData = {
  window: ChangeWindow;
  currency: string;
  /** Epoch ms. */
  start: number;
  end: number;
  value: {
    impact: number;
    moved: number;
    notRefreshed: number;
    noBaseline: number;
    unpriced: number;
    /** Newest price snapshot among held items, epoch ms. */
    lastRefreshAt: number | null;
  };
  gainers: Mover[];
  losers: Mover[];
  activity: Omit<Activity, "recent"> & {
    recent: (Omit<ActivityTx, "occurredAt"> & { t: number })[];
  };
  watch: WatchHit[];
  mentions: MentionChange[];
};

export async function getChanges(
  window: ChangeWindow,
  displayCurrency: CurrencyCode,
  now: Date = new Date(),
): Promise<ChangesData> {
  const { start, end } = windowBounds(window, now);

  const all = await listItemsWithValuations();
  const heldRows = all.filter(({ valuation }) => valuation.quantity > 0);
  const heldIds = heldRows.map(({ item }) => item.id);

  const watchRows = await safe(
    "watchlist",
    () =>
      db
        .select()
        .from(watchlistItems)
        .where(isNotNull(watchlistItems.targetBuyPriceCents)),
    [],
  );
  const watchItemIds = watchRows
    .map((w) => w.itemId)
    .filter((id): id is string => id != null);

  // One query for every price series we need, grouped here.
  const priceIds = Array.from(new Set([...heldIds, ...watchItemIds]));
  const priceRows =
    priceIds.length === 0
      ? []
      : await db
          .select({
            itemId: marketPrices.itemId,
            priceCents: marketPrices.priceCents,
            currency: marketPrices.currency,
            fetchedAt: marketPrices.fetchedAt,
          })
          .from(marketPrices)
          .where(inArray(marketPrices.itemId, priceIds))
          .orderBy(asc(marketPrices.fetchedAt));
  const historyByItem = new Map<string, PricePoint[]>();
  const priceCurrencyByItem = new Map<string, string>();
  for (const p of priceRows) {
    const list = historyByItem.get(p.itemId) ?? [];
    list.push({ fetchedAt: p.fetchedAt, priceCents: p.priceCents });
    historyByItem.set(p.itemId, list);
    priceCurrencyByItem.set(p.itemId, p.currency);
  }

  const txRows = await db
    .select({
      id: transactions.id,
      itemId: transactions.itemId,
      name: items.name,
      type: transactions.type,
      quantity: transactions.quantity,
      finalValueCents: transactions.finalValueCents,
      currency: transactions.currency,
      occurredAt: transactions.occurredAt,
      exitReason: transactions.exitReason,
    })
    .from(transactions)
    .innerJoin(items, sql`${items.id} = ${transactions.itemId}`)
    .where(gt(transactions.occurredAt, start));

  // One FX rate per distinct non-display currency in play.
  const currencies = new Set<string>();
  for (const { valuation } of heldRows) currencies.add(valuation.currency);
  for (const t of txRows) currencies.add(t.currency);
  currencies.delete(displayCurrency);
  currencies.delete("");
  const rates = new Map<string, number>();
  await Promise.all(
    Array.from(currencies).map(async (from) => {
      try {
        const { rate } = await getRate(from as CurrencyCode, displayCurrency);
        rates.set(from, rate);
      } catch {
        // Left unset: amounts in that currency are skipped, not guessed.
      }
    }),
  );
  const toDisplay = (minor: number, from: string): number | null => {
    if (from === displayCurrency) return minor;
    const rate = rates.get(from);
    return rate == null
      ? null
      : convertMinor(minor, from, displayCurrency, rate);
  };

  // ── Value change ───────────────────────────────────────────────────
  const held: HeldInput[] = heldRows.map(({ item, valuation }) => ({
    itemId: item.id,
    name: item.name,
    imageUrl: item.imageUrl,
    quantity: valuation.quantity,
    currency: priceCurrencyByItem.get(item.id) ?? valuation.currency,
    history: historyByItem.get(item.id) ?? [],
  }));
  const value = summarizeValueChange(held, start, end, toDisplay);
  const { gainers, losers } = pickMoversByImpact(value.movers, TOP_MOVERS);
  let lastRefresh: number | null = null;
  for (const h of held) {
    for (const p of h.history) {
      const t = p.fetchedAt.getTime();
      if (lastRefresh == null || t > lastRefresh) lastRefresh = t;
    }
  }

  // ── Activity ───────────────────────────────────────────────────────
  const activityTxs: ActivityTx[] = [];
  for (const t of txRows) {
    const total = toDisplay(t.finalValueCents, t.currency);
    if (total == null) continue;
    activityTxs.push({
      id: t.id,
      itemId: t.itemId,
      name: t.name,
      type: t.type,
      quantity: t.quantity,
      total,
      occurredAt: t.occurredAt,
      exitReason: t.exitReason,
    });
  }
  const activity = summarizeActivity(activityTxs, start, end);

  // ── Watchlist targets ──────────────────────────────────────────────
  const watchInputs: WatchInput[] = watchRows.flatMap((w) =>
    w.itemId && w.targetBuyPriceCents
      ? [
          {
            name: w.name,
            itemId: w.itemId,
            targetCents: w.targetBuyPriceCents,
            currency: w.currency,
            history: historyByItem.get(w.itemId) ?? [],
            priceCurrency: priceCurrencyByItem.get(w.itemId) ?? null,
          },
        ]
      : [],
  );
  const watch = watchHits(watchInputs, start, end);

  // ── Creator mentions of items you hold or watch ────────────────────
  const mentionIds = Array.from(new Set([...heldIds, ...watchItemIds]));
  const nameById = new Map<string, string>();
  for (const { item } of all) nameById.set(item.id, item.name);
  const heldSet = new Set(heldIds);
  const mentions = await safe(
    "mentions",
    async (): Promise<MentionChange[]> => {
      if (mentionIds.length === 0) return [];
      const rows = await db
        .select({
          itemId: youtubeInsightMentions.itemId,
          bullish: sql<string>`count(*) filter (where ${youtubeInsightMentions.sentiment} = 'bullish')`,
          bearish: sql<string>`count(*) filter (where ${youtubeInsightMentions.sentiment} = 'bearish')`,
        })
        .from(youtubeInsightMentions)
        .innerJoin(
          youtubeInsights,
          sql`${youtubeInsights.id} = ${youtubeInsightMentions.insightId}`,
        )
        .innerJoin(
          youtubeVideos,
          sql`${youtubeVideos.videoId} = ${youtubeInsights.videoId}`,
        )
        .where(
          and(
            inArray(youtubeInsightMentions.itemId, mentionIds),
            sql`coalesce(${youtubeVideos.publishedAt}, ${youtubeVideos.discoveredAt}) > ${start.toISOString()}::timestamptz`,
          ),
        )
        .groupBy(youtubeInsightMentions.itemId);
      return rows
        .map((r) => ({
          itemId: String(r.itemId),
          name: nameById.get(String(r.itemId)) ?? "Unknown item",
          bullish: Number(r.bullish),
          bearish: Number(r.bearish),
          held: heldSet.has(String(r.itemId)),
        }))
        .filter((r) => r.bullish + r.bearish > 0)
        .sort(
          (a, b) =>
            b.bullish + b.bearish - (a.bullish + a.bearish) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, 6);
    },
    [],
  );

  return {
    window,
    currency: displayCurrency,
    start: start.getTime(),
    end: end.getTime(),
    value: {
      impact: value.impact,
      moved: value.moved,
      notRefreshed: value.notRefreshed,
      noBaseline: value.noBaseline,
      unpriced: value.unpriced,
      lastRefreshAt: lastRefresh,
    },
    gainers,
    losers,
    activity: {
      buys: activity.buys,
      sells: activity.sells,
      exits: activity.exits,
      recent: activity.recent.map(({ occurredAt, ...rest }) => ({
        ...rest,
        t: occurredAt.getTime(),
      })),
    },
    watch,
    mentions,
  };
}
