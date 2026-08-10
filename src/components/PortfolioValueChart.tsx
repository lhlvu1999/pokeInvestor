import { formatAmount, formatCompactAmount } from "@/lib/currency";
import type { PortfolioValuePoint } from "@/lib/server/portfolio";

type Props = {
  data: PortfolioValuePoint[];
  currency: string;
};

function shortDate(d: Date): string {
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/**
 * Portfolio value over time — cost basis (solid) plus market value (dashed
 * when data is complete, hidden until any item has a price snapshot). Same
 * responsive-SVG pattern as CashflowChart.
 */
export function PortfolioValueChart({ data, currency }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-sm text-zinc-500">
        No transactions yet — add some to see the portfolio value chart.
      </div>
    );
  }

  const hasMarket = data.some((d) => d.marketValue != null);
  const maxValue = Math.max(
    1,
    ...data.map((d) => Math.max(d.costBasis, d.marketValue ?? 0)),
  );

  // Layout constants (see CashflowChart for the responsive-SVG story).
  const stepX = 40;
  const padLeft = 44;
  const padRight = 12;
  const padTop = 16;
  const chartHeight = 180;
  const labelHeight = 28;
  const totalWidth = padLeft + padRight + (data.length - 1) * stepX;
  const totalHeight = padTop + chartHeight + labelHeight;

  const yFor = (v: number) =>
    padTop + chartHeight - (v / maxValue) * chartHeight;
  const xFor = (i: number) => padLeft + i * stepX;

  // Build path strings — market_value line may have gaps (null values) at
  // the start of the range.
  const costPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(d.costBasis)}`)
    .join(" ");
  const marketSegments: string[] = [];
  {
    let current = "";
    for (let i = 0; i < data.length; i++) {
      const v = data[i].marketValue;
      if (v == null) {
        if (current) {
          marketSegments.push(current);
          current = "";
        }
      } else {
        current += `${current === "" ? "M" : " L"} ${xFor(i)} ${yFor(v)}`;
      }
    }
    if (current) marketSegments.push(current);
  }

  // Gridlines (0, 25%, 50%, 75%, 100% of max).
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="block"
        style={{ minWidth: `${totalWidth / 1.6}px`, maxHeight: "240px" }}
        role="img"
        aria-label="Portfolio value over time"
      >
        {gridSteps.map((f) => {
          const y = padTop + chartHeight - f * chartHeight;
          return (
            <g key={f}>
              <line
                x1={padLeft}
                x2={totalWidth - padRight}
                y1={y}
                y2={y}
                className="stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-zinc-500 text-[10px]"
              >
                {formatCompactAmount(f * maxValue, currency)}
              </text>
            </g>
          );
        })}

        {/* Cost basis line + points */}
        <path
          d={costPath}
          fill="none"
          className="stroke-sky-600 dark:stroke-sky-400"
          strokeWidth={2}
        />
        {data.map((d, i) => {
          const cx = xFor(i);
          const cy = yFor(d.costBasis);
          const tip = `${shortDate(d.date)}\nCost basis: ${formatAmount(d.costBasis, currency)}\nHeld items: ${d.itemsHeld}`;
          return (
            <circle
              key={`c-${i}`}
              cx={cx}
              cy={cy}
              r={3}
              className="fill-sky-600 dark:fill-sky-400"
            >
              <title>{tip}</title>
            </circle>
          );
        })}

        {/* Market value line (may have gaps) + points */}
        {hasMarket &&
          marketSegments.map((seg, i) => (
            <path
              key={`m-${i}`}
              d={seg}
              fill="none"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              strokeWidth={2}
              strokeDasharray="5 3"
            />
          ))}
        {hasMarket &&
          data.map((d, i) => {
            if (d.marketValue == null) return null;
            const cx = xFor(i);
            const cy = yFor(d.marketValue);
            const tip = `${shortDate(d.date)}\nMarket value: ${formatAmount(d.marketValue, currency)}\nPriced items: ${d.itemsWithPrice}/${d.itemsHeld}`;
            return (
              <circle
                key={`m-p-${i}`}
                cx={cx}
                cy={cy}
                r={3}
                className="fill-emerald-600 dark:fill-emerald-400"
              >
                <title>{tip}</title>
              </circle>
            );
          })}

        {/* X-axis labels (every ~4th point to avoid crowding) */}
        {data.map((d, i) => {
          if (data.length > 12 && i % Math.ceil(data.length / 8) !== 0)
            return null;
          return (
            <text
              key={`x-${i}`}
              x={xFor(i)}
              y={padTop + chartHeight + 14}
              textAnchor="middle"
              className="fill-zinc-500 text-[10px]"
            >
              {shortDate(d.date)}
            </text>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-[2px] w-4 bg-sky-600 dark:bg-sky-400" />
          Cost basis
        </span>
        {hasMarket && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-[2px] w-4 border-t-2 border-dashed border-emerald-600 dark:border-emerald-400" />
            Market value
          </span>
        )}
        {!hasMarket && (
          <span className="text-zinc-500">
            Market value hidden — no price snapshots yet. Fetch prices from an
            item detail page.
          </span>
        )}
      </div>
    </div>
  );
}
