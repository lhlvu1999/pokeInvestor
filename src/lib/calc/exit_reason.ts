/**
 * Why a unit left inventory.
 *
 * A "sell" row is the only way stock leaves, so everything that is not a
 * normal sale — a gift, a loss, a pack opened for the pulls — is still stored
 * as a sell, tagged with a reason. That keeps holdings, cost basis and
 * realized profit identical to before: a unit that leaves for nothing is a
 * write-off equal to its cost.
 *
 * What changes is the SALE statistics (win rate, margin, days to sell):
 * giving a box away is not a bad sale, so those only count real sales.
 *
 * `null` in the database means a normal sale (and every buy), so existing
 * rows need no migration.
 */

export const EXIT_REASONS = ["sold", "gifted", "lost", "opened"] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  sold: "Sold",
  gifted: "Gifted",
  lost: "Lost / damaged",
  opened: "Opened",
};

/** One-line explanation shown under the picker. */
export const EXIT_REASON_HINTS: Record<ExitReason, string> = {
  sold: "Sold to a buyer for money.",
  gifted:
    "Given away. Counts as a write-off of its cost unless you enter a value.",
  lost: "Lost, stolen or damaged. Counts as a write-off of its cost.",
  opened:
    "Opened for the contents. Enter the value of what you kept, or leave 0 to write the cost off.",
};

export function isExitReason(v: unknown): v is ExitReason {
  return (
    typeof v === "string" && (EXIT_REASONS as readonly string[]).includes(v)
  );
}

/**
 * Normalize user input to what is stored: a buy never carries a reason, and
 * "sold" is stored as null (the default), so there is one way to say "sale".
 */
export function storedExitReason(
  type: "buy" | "sell",
  reason: string | null | undefined,
): Exclude<ExitReason, "sold"> | null {
  if (type !== "sell") return null;
  if (!isExitReason(reason) || reason === "sold") return null;
  return reason;
}

/** Display reason of a stored value: null → "sold". */
export function displayExitReason(
  stored: string | null | undefined,
): ExitReason {
  return isExitReason(stored) ? stored : "sold";
}

/** True for a real sale (the stored value is null or "sold"). */
export function isSale(stored: string | null | undefined): boolean {
  return displayExitReason(stored) === "sold";
}

/** Write-offs pre-fill a value of 0; a sale needs a price typed in. */
export function defaultsToZeroValue(reason: ExitReason): boolean {
  return reason === "gifted" || reason === "lost";
}
