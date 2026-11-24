/**
 * Remember the result of a slow async computation for a while.
 *
 * - While one computation is running, everyone asking waits for that same one
 *   (so a burst of page loads runs the query once, not once each).
 * - A failure is never remembered: the next ask tries again.
 * - `now` is injectable so expiry can be tested without waiting.
 */
export function cachedAsync<T>(
  compute: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<T> {
  let hit: { at: number; value: T } | null = null;
  let pending: Promise<T> | null = null;

  return () => {
    if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    if (pending) return pending;
    pending = compute()
      .then((value) => {
        hit = { at: now(), value };
        return value;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
