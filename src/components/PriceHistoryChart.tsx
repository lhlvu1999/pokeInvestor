import { formatAmount, formatCompactAmount } from "@/lib/currency";
import {
  seriesBounds,
  sortAscending,
  type PricePoint,
} from "@/lib/calc/price_history";

/**
 * Market-price history for a single item. Renders as a line with a
 * shaded band; the y-axis is padded around the observed range rather
 * than anchored at zero, because for a $150 product a 0-based axis
 * flattens every real move into a straight line.
 */
export function PriceHistoryChart({
  points,
  currency,
}: {
  points: PricePoint[];
  currency: string;
}) {
  const bounds = seriesBounds(points);
  if (!bounds || bounds.count === 0) {
    return (
      <div className="text-xs text-zinc-500">
        No price history yet. Refresh from eBay or set a manual price to start
        building one.
      </div>
    );
  }

  if (bounds.count === 1) {
    return (
      <div className="text-xs text-zinc-500">
        One snapshot so far ({formatAmount(bounds.lastCents, currency)}). The
        chart appears once there are at least two.
      </div>
    );
  }

  const sorted = sortAscending(points);
  const w = 480;
  const h = 120;
  const padL = 44;
  const padR = 8;
  const padT = 10;
  const padB = 20;

  // Pad the value range by 10% so the line doesn't graze the frame, and
  // guard the degenerate all-identical-prices case.
  const span = bounds.maxCents - bounds.minCents;
  const pad = span === 0 ? Math.max(1, bounds.maxCents * 0.05) : span * 0.1;
  const lo = bounds.minCents - pad;
  const hi = bounds.maxCents + pad;

  const t0 = sorted[0].fetchedAt.getTime();
  const t1 = sorted[sorted.length - 1].fetchedAt.getTime();
  const tSpan = t1 - t0 || 1;

  const x = (p: PricePoint) =>
    padL + ((p.fetchedAt.getTime() - t0) / tSpan) * (w - padL - padR);
  const y = (cents: number) =>
    padT + (1 - (cents - lo) / (hi - lo)) * (h - padT - padB);

  const line = sorted
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${x(p).toFixed(1)} ${y(p.priceCents).toFixed(1)}`,
    )
    .join(" ");
  const area =
    `${line} L ${x(sorted[sorted.length - 1]).toFixed(1)} ${h - padB} ` +
    `L ${x(sorted[0]).toFixed(1)} ${h - padB} Z`;

  const rising = bounds.lastCents >= bounds.firstCents;
  const stroke = rising
    ? "stroke-emerald-600 dark:stroke-emerald-400"
    : "stroke-rose-600 dark:stroke-rose-400";
  const fill = rising
    ? "fill-emerald-500/10 dark:fill-emerald-400/10"
    : "fill-rose-500/10 dark:fill-rose-400/10";

  const fmtDate = (dt: Date) => `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="block"
        style={{ maxHeight: "160px" }}
        role="img"
        aria-label="Market price history"
      >
        {[0, 0.5, 1].map((f) => {
          const cents = lo + (hi - lo) * (1 - f);
          const yy = padT + f * (h - padT - padB);
          return (
            <g key={f}>
              <line
                x1={padL}
                x2={w - padR}
                y1={yy}
                y2={yy}
                className="stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={padL - 6}
                y={yy + 3}
                textAnchor="end"
                className="fill-zinc-500 text-[9px]"
              >
                {formatCompactAmount(Math.round(cents), currency)}
              </text>
            </g>
          );
        })}

        <path d={area} className={fill} stroke="none" />
        <path d={line} fill="none" className={stroke} strokeWidth={2} />

        {sorted.map((p, i) => (
          <circle
            key={i}
            cx={x(p)}
            cy={y(p.priceCents)}
            r={2.5}
            className={
              rising
                ? "fill-emerald-600 dark:fill-emerald-400"
                : "fill-rose-600 dark:fill-rose-400"
            }
          >
            <title>{`${fmtDate(p.fetchedAt)} — ${formatAmount(p.priceCents, currency)}`}</title>
          </circle>
        ))}

        <text x={padL} y={h - 6} className="fill-zinc-500 text-[9px]">
          {fmtDate(sorted[0].fetchedAt)}
        </text>
        <text
          x={w - padR}
          y={h - 6}
          textAnchor="end"
          className="fill-zinc-500 text-[9px]"
        >
          {fmtDate(sorted[sorted.length - 1].fetchedAt)}
        </text>
      </svg>
      <div className="text-[10px] text-zinc-500 mt-1 tabular-nums">
        {bounds.count} snapshots · low {formatAmount(bounds.minCents, currency)}{" "}
        · high {formatAmount(bounds.maxCents, currency)}
      </div>
    </div>
  );
}
