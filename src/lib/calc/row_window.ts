/**
 * Show a long list a window at a time.
 *
 * Tables here render every row twice (a card for phones, a row for wider
 * screens) and the server sends all of it as HTML, so a ledger of a few
 * thousand rows becomes a multi-megabyte page. Filtering and sorting still look
 * at EVERY row; only how many are drawn is limited, and "Show more" widens it.
 */

export type RowWindow = {
  /** How many rows to draw. */
  shown: number;
  total: number;
  hasMore: boolean;
};

/** `extra` is how many additional pages the person has asked for. */
export function rowWindow(total: number, pageSize: number, extra: number): RowWindow {
  const wanted = Math.max(1, pageSize) + Math.max(0, extra);
  const shown = Math.min(total, wanted);
  return { shown, total, hasMore: shown < total };
}

/** The label under a windowed list: "Showing 300 of 565". Null when nothing is hidden. */
export function windowLabel(w: RowWindow, noun: string): string | null {
  return w.hasMore ? `Showing ${w.shown.toLocaleString("en-US")} of ${w.total.toLocaleString("en-US")} ${noun}` : null;
}
