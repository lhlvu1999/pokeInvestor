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
    // Fail fast and clearly if eBay cannot be reached with the keys we have,
    // instead of reporting a hundred identical per-item errors.
    try {
      await getAppToken();
    } catch (err) {
      const why = err instanceof EbayError ? err.message : "Could not reach eBay.";
      return { ok: false, status: 503, error: why };
    }
    const { eligible, onCooldown } = await listPriceRefreshTargets(true);
    const done = await runRefresh(eligible, (ids) => refreshPricesForItems(ids), {
      ...DEFAULTS,
      now: Date.now,
    });
    return { ok: true, summary: withCooledDown(done, onCooldown.length) };
  } finally {
    running = false;
  }
}
