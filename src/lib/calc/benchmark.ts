/**
 * Which index a position is compared with.
 *
 * - "match": the index for its own kind of product (booster boxes, Elite
 *   Trainer Boxes, bundles or packs) in its own language, falling back to all
 *   sealed products of that language when its kind has no index of its own.
 * - "all": all sealed products, in the position's language.
 *
 * A position that isn't linked to the catalogue has no known kind or
 * language, so it is compared with English sealed products overall.
 */

import type { IndexMetric } from "./insight_params";
import { SEALED_TYPE_LABELS, type SealedType } from "./sealed_type";

export type BenchMode = "match" | "all";

export const BENCH_MODES: ReadonlyArray<BenchMode> = ["match", "all"];

export const BENCH_MODE_LABELS: Record<BenchMode, string> = {
  match: "Matching kind",
  all: "All sealed",
};

export type Benchmark = { metric: IndexMetric; language: "en" | "ja" };

export function parseBenchMode(raw: string | string[] | undefined): BenchMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "all" ? "all" : "match";
}

/**
 * The benchmark for a position, or null when no suitable index exists.
 * `has` says whether an index exists for a metric and language.
 */
export function chooseBenchmark(
  mode: BenchMode,
  kind: SealedType | null,
  language: "en" | "ja" | null,
  has: (metric: IndexMetric, language: "en" | "ja") => boolean,
): Benchmark | null {
  const lang = language ?? "en";
  const wanted: IndexMetric = mode === "match" && kind ? kind : "sealed_all";
  if (has(wanted, lang)) return { metric: wanted, language: lang };
  if (has("sealed_all", lang)) return { metric: "sealed_all", language: lang };
  return null;
}

export function benchmarkLabel(b: Benchmark): string {
  const what =
    b.metric === "sealed_all"
      ? "All sealed"
      : b.metric === "set_total" || b.metric === "set_top20"
        ? b.metric === "set_total"
          ? "Set value"
          : "Top 20 cards"
        : SEALED_TYPE_LABELS[b.metric as SealedType];
  return `${what} (${b.language === "ja" ? "Japanese" : "English"})`;
}
