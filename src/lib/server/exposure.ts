/**
 * Loader for the Exposure page: what the held stock is made of, and the stock
 * replayed through the market's history. A pure read (no "use server").
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { benchmarkLabel, chooseBenchmark } from "@/lib/calc/benchmark";
import {
  concentration,
  sliceBy,
  type Concentration,
  type Holding,
  type Slice,
} from "@/lib/calc/exposure";
import type { IndexPoint } from "@/lib/calc/market_index";
import {
  SEALED_TYPE_LABELS,
  sealedType,
  type SealedType,
} from "@/lib/calc/sealed_type";
import { mixIndex, worstWindow, type Window } from "@/lib/calc/stress";
import type { CurrencyCode } from "@/lib/currency";
import { getMarketIndexes } from "@/lib/server/catalog_insights";
import { getProductMoves, type Moves } from "@/lib/server/catalog_moves";
import { getDashboardData } from "@/lib/server/portfolio";

export type StressWindow = {
  days: number;
  /** The worst stretch of that length, or null when the history is shorter. */
  window: Window | null;
  /** What that change would be on today's stock (display currency, minor units). */
  money: number | null;
};

/** One group of your stock and how products like it have actually moved. */
export type MoveRow = {
  /** "etb:en", "sealed_all:ja", … */
  key: string;
  label: string;
  value: number;
  share: number;
  /** Spread of product price changes over 30 and 90 days; null if none. */
  moves: { 30: Moves | null; 90: Moves | null };
};

export type ExposureData = {
  currency: CurrencyCode;
  holdings: Holding[];
  total: number;
  byKind: Slice[];
  byLanguage: Slice[];
  bySet: Slice[];
  concentration: Concentration;
  /** Share (0–1) of the value that is at cost because it has no market price. */
  atCostShare: number;
  /** Your stock grouped by the kind of product it is compared with. */
  moveRows: MoveRow[];
  stress: {
    windows: StressWindow[];
    /** The day the blended history starts (it can't start before the youngest index). */
    from: string;
    to: string;
    /** Share (0–1) of the value compared with an index for its own kind. */
    matchedShare: number;
  } | null;
};

type MetaRow = {
  product_id: string;
  name: string;
  language: string;
  group_id: string;
  set_name: string;
};

const STRESS_WINDOWS = [30, 90] as const;

export async function getExposure(
  displayCurrency: CurrencyCode,
): Promise<ExposureData> {
  const dash = await getDashboardData(displayCurrency);

  const held = dash.items
    .map((it, i) => ({ it, conv: dash.converted[i] }))
    .filter(({ it }) => it.valuation.quantity > 0);

  const linkedIds = held
    .map(({ it }) => it.item.catalogProductId)
    .filter((id): id is number => id != null)
    .map(Number);
  const metas = new Map<number, MetaRow>();
  if (linkedIds.length > 0) {
    const rows = await db.execute<MetaRow>(sql`
      SELECT c.product_id::text AS product_id, c.name, s.language,
             s.group_id::text AS group_id, s.name AS set_name
        FROM catalog_products c JOIN catalog_sets s ON s.group_id = c.group_id
       WHERE c.product_id IN (
         SELECT jsonb_array_elements_text(${JSON.stringify([...new Set(linkedIds)])}::jsonb)::bigint)
    `);
    for (const r of rows) metas.set(Number(r.product_id), r);
  }

  const holdings: Holding[] = [];
  for (const { it, conv } of held) {
    const meta =
      it.item.catalogProductId != null
        ? (metas.get(Number(it.item.catalogProductId)) ?? null)
        : null;
    const kind = meta ? (sealedType(meta.name) ?? "other") : "unlinked";
    holdings.push({
      itemId: it.item.id,
      name: it.item.name,
      value: conv.hasPrice ? conv.marketValue : conv.inventoryCost,
      atCost: !conv.hasPrice,
      kind,
      language: meta ? (meta.language === "ja" ? "ja" : "en") : null,
      setId: meta ? Number(meta.group_id) : null,
      setName: meta?.set_name ?? null,
    });
  }

  const total = holdings.reduce((a, h) => a + Math.max(0, h.value), 0);
  const atCostValue = holdings
    .filter((h) => h.atCost)
    .reduce((a, h) => a + Math.max(0, h.value), 0);

  const byKind = sliceBy(holdings, (h) => ({
    key: h.kind,
    label:
      h.kind === "unlinked"
        ? "Not linked to the catalogue"
        : h.kind === "other"
          ? "Other sealed (tins, collections, blisters)"
          : SEALED_TYPE_LABELS[h.kind as SealedType],
  }));
  const byLanguage = sliceBy(holdings, (h) => ({
    key: h.language ?? "unknown",
    label:
      h.language === "ja"
        ? "Japanese"
        : h.language === "en"
          ? "English"
          : "Not linked to the catalogue",
  }));
  const bySet = sliceBy(holdings, (h) =>
    h.setId != null
      ? { key: String(h.setId), label: h.setName ?? `Set ${h.setId}` }
      : { key: "unlinked", label: "Not linked to the catalogue" },
  );

  // Replay today's mix through history: each position is compared with the
  // index for its own kind where there is one (all sealed otherwise).
  const indexes = await getMarketIndexes();
  const seriesBy = new Map<string, ReadonlyArray<IndexPoint>>(
    indexes.series.map((s) => [`${s.metric}:${s.language}`, s.points]),
  );
  const weights = new Map<string, number>();
  let matchedValue = 0;
  for (const h of holdings) {
    if (!(h.value > 0)) continue;
    const bench = chooseBenchmark(
      "match",
      h.kind === "other" || h.kind === "unlinked" ? null : (h.kind as SealedType),
      h.language,
      (m, l) => seriesBy.has(`${m}:${l}`),
    );
    if (!bench) continue;
    const key = `${bench.metric}:${bench.language}`;
    weights.set(key, (weights.get(key) ?? 0) + h.value);
    if (bench.metric !== "sealed_all") matchedValue += h.value;
  }
  const moves = await getProductMoves();
  const moveRows: MoveRow[] = [...weights]
    .map(([key, value]) => {
      const [metric, language] = key.split(":") as [string, "en" | "ja"];
      return {
        key,
        label: benchmarkLabel({ metric: metric as never, language }),
        value,
        share: total > 0 ? value / total : 0,
        moves: {
          30: moves[30].get(key) ?? null,
          90: moves[90].get(key) ?? null,
        },
      };
    })
    .sort((a, b) => b.value - a.value);
  const mix = mixIndex(
    [...weights].map(([key, weight]) => ({
      weight,
      series: seriesBy.get(key) ?? [],
    })),
  );
  const stress =
    mix.length > 1 && total > 0
      ? {
          windows: STRESS_WINDOWS.map((days) => {
            const window = worstWindow(mix, days);
            return {
              days,
              window,
              money: window ? Math.round(total * window.change) : null,
            };
          }),
          from: mix[0].day,
          to: mix[mix.length - 1].day,
          matchedShare: matchedValue / total,
        }
      : null;

  return {
    currency: displayCurrency,
    holdings,
    total,
    byKind,
    byLanguage,
    bySet,
    concentration: concentration(holdings),
    atCostShare: total > 0 ? atCostValue / total : 0,
    moveRows,
    stress,
  };
}
