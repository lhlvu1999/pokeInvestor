import type { Bucket } from "@/lib/calc/analytics";

type Props = {
  buckets: ReadonlyArray<Bucket>;
  /**
   * Optional Tailwind class string per bucket (sign-aware coloring etc).
   * Defaults to neutral zinc.
   */
  fillClassFor?: (b: Bucket) => string;
  /** Optional text to show on hover under each bar. */
  tooltipFor?: (b: Bucket) => string;
  emptyText?: string;
};

export function Histogram({
  buckets,
  fillClassFor,
  tooltipFor,
  emptyText = "No data yet",
}: Props) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) {
    return <div className="text-sm text-zinc-500">{emptyText}</div>;
  }
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  // The SVG fills its container via width="100%" + preserveAspectRatio.
  // Bars and gaps are sized in viewBox units; they scale up on wide screens.
  const barWidth = 56;
  const gap = 14;
  const chartHeight = 160;
  const labelHeight = 36;
  const padTop = 14;
  const padX = 8;
  const totalHeight = padTop + chartHeight + labelHeight;
  const totalWidth =
    padX * 2 + buckets.length * barWidth + (buckets.length - 1) * gap;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Histogram"
        className="block"
        style={{ maxHeight: "220px" }}
      >
        <line
          x1={0}
          x2={totalWidth}
          y1={padTop + chartHeight}
          y2={padTop + chartHeight}
          className="stroke-zinc-300 dark:stroke-zinc-700"
          strokeWidth={1}
        />
        {buckets.map((b, i) => {
          const h = (b.count / maxCount) * chartHeight;
          const x = padX + i * (barWidth + gap);
          const baseY = padTop + chartHeight;
          const cls =
            fillClassFor?.(b) ??
            "fill-zinc-400/80 dark:fill-zinc-500/70";
          return (
            <g key={b.label}>
              <rect
                x={x}
                y={baseY - h}
                width={barWidth}
                height={h}
                rx={2}
                className={cls}
              >
                <title>{tooltipFor?.(b) ?? `${b.label}: ${b.count}`}</title>
              </rect>
              {b.count > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={baseY - h - 2}
                  textAnchor="middle"
                  className="fill-zinc-600 dark:fill-zinc-300 text-[10px] tabular-nums"
                >
                  {b.count}
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={baseY + 14}
                textAnchor="middle"
                className="fill-zinc-500 text-[10px]"
              >
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
