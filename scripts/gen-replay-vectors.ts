/**
 * Writes pipeline/tests/fixtures/replay_vectors.json: random transaction
 * histories with the cost the APP's replay (src/lib/calc/analytics.ts) assigns
 * to every sell and to what is left. The Python weekly digest has its own copy
 * of that replay (pipeline/src/poke_pipeline/replay.py); both are tested
 * against this file, so a change to one that is not made in the other fails.
 *
 *   npx tsx scripts/gen-replay-vectors.ts
 */
import { writeFileSync } from "node:fs";
import { replayForAnalytics } from "../src/lib/calc/analytics";
import type { CostMethod } from "../src/lib/calc/holdings";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tx = {
  id: string;
  type: "buy" | "sell";
  quantity: number;
  finalValueCents: number;
  occurredAt: string;
  lotId: string | null;
  status: "received" | "pending";
  exitReason: string | null;
};

const BASE = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function makeCase(seed: number): Tx[] {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const lots = ["lot-a", "lot-b", "lot-c"].slice(0, int(1, 3));
  const n = int(4, 14);
  const txs: Tx[] = [];
  for (let i = 0; i < n; i++) {
    const buy = i === 0 || r() < 0.5;
    const lotSell = !buy && r() < 0.35;
    txs.push({
      id: `t${seed}-${i}`,
      type: buy ? "buy" : "sell",
      quantity: int(1, 6),
      // Awkward numbers on purpose, so rounding paths are exercised.
      finalValueCents: int(0, 400) * 1000 + int(0, 999),
      occurredAt: new Date(BASE + (i + 1) * DAY + int(0, 40_000) * 1000).toISOString(),
      lotId: buy ? (r() < 0.6 ? lots[int(0, lots.length - 1)] : null) : lotSell ? lots[int(0, lots.length - 1)] : null,
      status: buy && r() < 0.12 ? "pending" : "received",
      exitReason: !buy && r() < 0.2 ? ["gifted", "lost", "opened"][int(0, 2)] : null,
    });
  }
  return txs;
}

const cases = [];
for (let seed = 1; seed <= 80; seed++) {
  const txs = makeCase(seed);
  for (const method of ["fifo", "average"] as CostMethod[]) {
    const { sells, remaining } = replayForAnalytics(
      txs.map((t) => ({
        ...t,
        occurredAt: new Date(t.occurredAt),
        currency: "VND",
      })) as never,
      method,
    );
    cases.push({
      method,
      txs,
      sells: sells.map((s) => ({
        id: s.sellTxId,
        consumed: s.consumedCostCents,
        quantity: s.quantity,
        exitReason: s.exitReason,
      })),
      remaining: remaining.map((e) => ({ qty: e.qty, cost: e.cost })),
    });
  }
}
writeFileSync(
  "pipeline/tests/fixtures/replay_vectors.json",
  JSON.stringify({ cases }, null, 1) + "\n",
);
console.log(`wrote ${cases.length} cases`);
