/**
 * Run an OPTIONAL data source, falling back instead of throwing.
 *
 * The dashboard is the front door. A panel that is a nice-to-have (sell
 * signals, the watchlist) failing — say because a table hasn't been
 * created yet after an upgrade — must not take the whole page down with a
 * 500. Core figures (the portfolio summary) deliberately do NOT use this:
 * if those are wrong, failing loudly is the right behaviour.
 */
export async function safe<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[dashboard] optional source "${label}" failed:`, err);
    return fallback;
  }
}
