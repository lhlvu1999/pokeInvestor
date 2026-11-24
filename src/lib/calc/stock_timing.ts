/**
 * How the money in your stock splits by how old the products are.
 */

import { PHASE_LABELS, type Phase } from "./lifecycle";

export const PHASE_ORDER: ReadonlyArray<Phase> = [
  "upcoming",
  "launch",
  "early",
  "first_year",
  "established",
];

export type PhaseShare = {
  phase: Phase;
  label: string;
  /** Inventory cost in this age band (display-currency minor units). */
  cost: number;
  /** Share of all inventory cost, 0–1. */
  share: number;
};

export type CostByPhase = {
  /** Only age bands that hold something, youngest first. */
  shares: PhaseShare[];
  /** Cost where the age isn't known (not linked, no release date…). */
  unknownCost: number;
  unknownShare: number;
  total: number;
};

/** Split inventory cost by age band. Zero or negative costs are ignored. */
export function costByPhase(
  rows: ReadonlyArray<{ cost: number; phase: Phase | null }>,
): CostByPhase {
  const byPhase = new Map<Phase, number>();
  let unknownCost = 0;
  let total = 0;
  for (const r of rows) {
    if (!(r.cost > 0)) continue;
    total += r.cost;
    if (r.phase == null) unknownCost += r.cost;
    else byPhase.set(r.phase, (byPhase.get(r.phase) ?? 0) + r.cost);
  }
  const shares: PhaseShare[] = PHASE_ORDER.filter((p) => byPhase.has(p)).map(
    (phase) => {
      const cost = byPhase.get(phase)!;
      return { phase, label: PHASE_LABELS[phase], cost, share: cost / total };
    },
  );
  return {
    shares,
    unknownCost,
    unknownShare: total > 0 ? unknownCost / total : 0,
    total,
  };
}
