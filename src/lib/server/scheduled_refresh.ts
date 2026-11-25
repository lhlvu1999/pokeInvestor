import { EbayError, getAppToken } from "@/lib/ebay";
import { DEFAULTS, runRefresh, withCooledDown, type RefreshSummary } from "@/lib/calc/refresh_run";
import { listPriceRefreshTargets, refreshPricesForItems } from "./prices";

/**
 * The scheduled price refresh: the same thing the "Update all prices" button does
 * (held items only, the one-hour cooldown, low-confidence estimates reported but
 * not saved), driven by a loop with a time budget instead of by a person.
 *
 * Plain module, not "use server": it is reached only from the cron route.
 */

let running = false;

export type ScheduledResult =
  | { ok: true; summary: RefreshSummary }
  | { ok: false; status: 503 | 409; error: string };

export async function runScheduledRefresh(): Promise<ScheduledResult> {
  if (running) return { ok: false, status: 409, error: "A refresh is already running." };
  running = true;
  try {
    const { eligible, onCooldown, tcg } = await listPriceRefreshTargets(true);

    // Items the catalogue can price use TCGplayer's market price and need no eBay
    // call, so they are done first and do not depend on eBay being reachable.
    // Fail fast and clearly if eBay cannot be reached with the keys we have,
    // instead of reporting a hundred identical per-item errors.
    let ebayWhy: string | null = null;
    if (eligible.length > 0) {
      try {
        await getAppToken();
      } catch (err) {
        ebayWhy = err instanceof EbayError ? err.message : "Could not reach eBay.";
      }
    }
    if (ebayWhy && tcg.length === 0) return { ok: false, status: 503, error: ebayWhy };

    const queue = ebayWhy ? tcg : [...tcg, ...eligible];
    const done = await runRefresh(queue, (ids) => refreshPricesForItems(ids), {
      ...DEFAULTS,
      now: Date.now,
    });
    // The catalogue prices were still applied; the run is reported as failed so a
    // scheduler shows that the eBay part did not happen.
    const summary = ebayWhy ? { ...done, stopped: "error" as const, firstError: ebayWhy } : done;
    return { ok: true, summary: withCooledDown(summary, onCooldown.length) };
  } finally {
    running = false;
  }
}
