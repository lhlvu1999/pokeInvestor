/**
 * Axis helpers for the hand-drawn SVG charts.
 */

/**
 * Round-numbered tick values covering [lo, hi], about `target` of them.
 * Steps are 1, 2, 2.5 or 5 times a power of ten, and the first and last ticks
 * sit at or outside the data so the whole range is on the axis.
 */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) return [lo];
  if (lo > hi) [lo, hi] = [hi, lo];

  const raw = (hi - lo) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;

  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) {
    // Strip floating-point dust (0.30000000000000004).
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}
