import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replayForAnalytics } from "./analytics";
import type { CostMethod } from "./holdings";

/**
 * The Python weekly digest replays your sales with its own copy of this logic
 * (pipeline/src/poke_pipeline/replay.py). Both are checked against this file.
 * If this test fails, the app's replay changed: regenerate the file with
 * `npx tsx scripts/gen-replay-vectors.ts`, then update replay.py until
 * `uv run pytest tests/test_replay.py` passes again.
 */
type Case = {
  method: CostMethod;
  txs: {
    id: string;
    type: "buy" | "sell";
    quantity: number;
    finalValueCents: number;
    occurredAt: string;
    lotId: string | null;
    status: "received" | "pending";
    exitReason: string | null;
  }[];
  sells: { id: string; consumed: number; quantity: number; exitReason: string | null }[];
  remaining: { qty: number; cost: number }[];
};

const cases = (
  JSON.parse(readFileSync("pipeline/tests/fixtures/replay_vectors.json", "utf8")) as {
    cases: Case[];
  }
).cases;

describe("replay vectors", () => {
  it("has plenty of cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
  });
  it("still match what the app computes", () => {
    for (const c of cases) {
      const { sells, remaining } = replayForAnalytics(
        c.txs.map((t) => ({ ...t, occurredAt: new Date(t.occurredAt), currency: "VND" })) as never,
        c.method,
      );
      expect(
        sells.map((s) => ({
          id: s.sellTxId,
          consumed: s.consumedCostCents,
          quantity: s.quantity,
          exitReason: s.exitReason,
        })),
      ).toEqual(c.sells);
      expect(remaining.map((e) => ({ qty: e.qty, cost: e.cost }))).toEqual(c.remaining);
    }
  });
});
