/**
 * Runs a price refresh over many items in small chunks, within a time budget.
 *
 * The work for one chunk is done elsewhere (the same code the "Update all prices"
 * button uses); this decides how to loop: how big a chunk is, when to stop, and
 * how to report. Pure, so those rules can be tested without eBay or a database.
 */

export type RefreshStatus = "saved" | "skipped" | "no_data" | "error" | "cooldown";

export type RefreshOutcome = {
  itemName: string;
  status: RefreshStatus;
  message?: string;
};

export type ChunkResult =
  | { ok: true; data: RefreshOutcome[] }
  | { ok: false; error: string };

export type RunOptions = {
  chunkSize: number;
  /** Stop starting new chunks after this many milliseconds. */
  budgetMs: number;
  /** Never touch more than this many items in one run. */
  maxItems: number;
  now: () => number;
};

export const DEFAULTS = {
  chunkSize: 8,
  budgetMs: 8 * 60_000,
  maxItems: 500,
};

/** Two chunks in a row where every item failed: the credentials or eBay are down. */
export const FAILING_CHUNKS_BEFORE_STOP = 2;

export type StoppedBecause = "budget" | "limit" | "failing" | "error" | null;

export type RefreshSummary = {
  considered: number;
  attempted: number;
  saved: number;
  skipped: number;
  noData: number;
  errors: number;
  cooldown: number;
  stopped: StoppedBecause;
  firstError: string | null;
  /** Items that did not get a price and may need attention (at most 20). */
  problems: { name: string; status: RefreshStatus; message: string | null }[];
  durationMs: number;
};

const MAX_PROBLEMS = 20;

export async function runRefresh(
  targets: readonly { id: string }[],
  refreshChunk: (ids: string[]) => Promise<ChunkResult>,
  opts: RunOptions,
): Promise<RefreshSummary> {
  const start = opts.now();
  const queue = targets.slice(0, opts.maxItems);
  const sum: RefreshSummary = {
    considered: targets.length,
    attempted: 0,
    saved: 0,
    skipped: 0,
    noData: 0,
    errors: 0,
    cooldown: 0,
    stopped: targets.length > opts.maxItems ? "limit" : null,
    firstError: null,
    problems: [],
    durationMs: 0,
  };
  let failingStreak = 0;

  for (let i = 0; i < queue.length; i += opts.chunkSize) {
    if (opts.now() - start >= opts.budgetMs) {
      sum.stopped = "budget";
      break;
    }
    const ids = queue.slice(i, i + opts.chunkSize).map((t) => t.id);
    const res = await refreshChunk(ids);
    if (!res.ok) {
      sum.stopped = "error";
      sum.firstError ??= res.error;
      break;
    }
    sum.attempted += ids.length;
    for (const o of res.data) {
      if (o.status === "saved") sum.saved += 1;
      else if (o.status === "skipped") sum.skipped += 1;
      else if (o.status === "no_data") sum.noData += 1;
      else if (o.status === "cooldown") sum.cooldown += 1;
      else {
        sum.errors += 1;
        sum.firstError ??= o.message ?? "error";
      }
      if ((o.status === "skipped" || o.status === "no_data" || o.status === "error") && sum.problems.length < MAX_PROBLEMS) {
        sum.problems.push({ name: o.itemName, status: o.status, message: o.message ?? null });
      }
    }
    const allFailed = res.data.length > 0 && res.data.every((o) => o.status === "error");
    failingStreak = allFailed ? failingStreak + 1 : 0;
    if (failingStreak >= FAILING_CHUNKS_BEFORE_STOP) {
      sum.stopped = "failing";
      break;
    }
  }
  sum.durationMs = opts.now() - start;
  return sum;
}

/**
 * Items held but priced within the cooldown are never sent for a refresh; they
 * still belong in the report, as "priced recently", so the numbers add up to
 * everything held.
 */
export function withCooledDown(s: RefreshSummary, cooledDown: number): RefreshSummary {
  return { ...s, considered: s.considered + cooledDown, cooldown: s.cooldown + cooledDown };
}

/** The run counts as a success unless it stopped because things were failing. */
export function runSucceeded(s: RefreshSummary): boolean {
  return s.stopped !== "failing" && s.stopped !== "error";
}
