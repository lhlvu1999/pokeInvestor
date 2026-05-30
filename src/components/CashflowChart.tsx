import { formatAmount, formatCompactAmount } from "@/lib/currency";
import type { MonthlyCashflow } from "@/lib/server/portfolio";

type Props = {
  data: MonthlyCashflow[];
  currency: string;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function shortMonth(monthKey: string): string {
  // "YYYY-MM" → "Jan '25"
  const [yy, mm] = monthKey.split("-");
  const idx = Number(mm) - 1;
  const yearShort = yy.slice(2);
  return `${MONTH_LABELS[idx] ?? mm} '${yearShort}`;
}

export function CashflowChart({ data, currency }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-sm text-zinc-500">
        No transactions yet — add some to see the cashflow chart.
      </div>
    );
  }

  const maxFlow = Math.max(
    1,
    ...data.map((d) => Math.max(d.spend, d.revenue)),
  );

  // Layout — bars are wider; the SVG itself fills the container via
  // `width="100%"` and `preserveAspectRatio="xMidYMid meet"`, so the bars
  // scale up nicely on wide screens.
  const barWidth = 22;
  const gapBetweenPair = 6;
  const groupGap = 42;
  const groupWidth = barWidth * 2 + gapBetweenPair;
  const chartHeight = 180;
  const labelHeight = 36;
  const realizedHeight = 18;
  const padTop = 8;
  const totalHeight = padTop + chartHeight + labelHeight + realizedHeight;
  const totalWidth =
    data.length * groupWidth + (data.length - 1) * groupGap + 16;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="block"
        style={{ minWidth: `${totalWidth / 1.4}px`, maxHeight: "240px" }}
        role="img"
        aria-label="Monthly cashflow"
      >
        {/* Baseline */}
        <line
          x1={0}
          x2={totalWidth}
          y1={padTop + chartHeight}
          y2={padTop + chartHeight}
          className="stroke-zinc-300 dark:stroke-zinc-700"
          strokeWidth={1}
        />
        {data.map((d, i) => {
          const groupX = 8 + i * (groupWidth + groupGap);
          const spendH = (d.spend / maxFlow) * chartHeight;
          const shippingH =
            d.spend > 0 ? (d.shipping / maxFlow) * chartHeight : 0;
          const revenueH = (d.revenue / maxFlow) * chartHeight;
          const baseY = padTop + chartHeight;
          const realizedColor =
            d.realized > 0
              ? "fill-emerald-600 dark:fill-emerald-400"
              : d.realized < 0
                ? "fill-rose-600 dark:fill-rose-400"
                : "fill-zinc-500";

          // Pre-compute tooltip text as a single string per bar — interpolating
          // text + expressions directly inside <title> creates multiple React
          // children, which SSR collapses and the client splits, triggering a
          // hydration mismatch.
          const spendTitle =
            d.shipping > 0
              ? `${shortMonth(d.month)} spend: ${formatAmount(d.spend, currency)} (item: ${formatAmount(d.spend - d.shipping, currency)})`
              : `${shortMonth(d.month)} spend: ${formatAmount(d.spend, currency)}`;
          const shippingTitle = `${shortMonth(d.month)} shipping: ${formatAmount(d.shipping, currency)}`;
          const revenueTitle = `${shortMonth(d.month)} revenue: ${formatAmount(d.revenue, currency)}`;

          return (
            <g key={d.month}>
              {/* Spend bar — item-cost portion (lighter red, on top) */}
              <rect
                x={groupX}
                y={baseY - spendH}
                width={barWidth}
                height={spendH - shippingH}
                rx={2}
                className="fill-rose-400/80 dark:fill-rose-500/70"
              >
                <title>{spendTitle}</title>
              </rect>
              {/* Shipping portion (darker, at the base of the spend bar) */}
              {shippingH > 0 && (
                <rect
                  x={groupX}
                  y={baseY - shippingH}
                  width={barWidth}
                  height={shippingH}
                  rx={2}
                  className="fill-rose-700/80 dark:fill-rose-800/80"
                >
                  <title>{shippingTitle}</title>
                </rect>
              )}
              {/* Revenue bar (green) */}
              <rect
                x={groupX + barWidth + gapBetweenPair}
                y={baseY - revenueH}
                width={barWidth}
                height={revenueH}
                rx={2}
                className="fill-emerald-500/80 dark:fill-emerald-400/70"
              >
                <title>{revenueTitle}</title>
              </rect>
              {/* Month label */}
              <text
                x={groupX + groupWidth / 2}
                y={baseY + 14}
                textAnchor="middle"
                className="fill-zinc-500 text-[10px]"
              >
                {shortMonth(d.month)}
              </text>
              {/* Realized profit (text) */}
              <text
                x={groupX + groupWidth / 2}
                y={baseY + 30}
                textAnchor="middle"
                className={`text-[10px] tabular-nums ${realizedColor}`}
              >
                <title>
                  {d.realized === 0
                    ? `${shortMonth(d.month)} realized: 0`
                    : `${shortMonth(d.month)} realized: ${(d.realized > 0 ? "+" : "") + formatAmount(d.realized, currency)}`}
                </title>
                {d.realized === 0
                  ? "—"
                  : (d.realized > 0 ? "+" : "") +
                    formatCompactAmount(d.realized, currency)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 mt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-400" />{" "}
          Spend (item)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-700" />{" "}
          Spend (shipping)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />{" "}
          Revenue
        </span>
        <span className="ml-auto">
          Realized profit shown beneath each month.
        </span>
      </div>
    </div>
  );
}
