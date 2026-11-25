import { Card } from "@/components/ui";
import { Money } from "@/components/Money";
import {
  lastMonths,
  type CapitalFlow,
  type CapitalMonth,
} from "@/lib/calc/capital";
import {
  capMagnitude,
  formatMonthLong,
  formatMonthShort,
  niceDomain,
} from "@/lib/calc/cashflow_window";
import { pct, tone } from "@/lib/calc/format_delta";
import { formatAmount, formatCompactAmount } from "@/lib/currency";

/** Months drawn. Lifetime totals above always cover everything. */
const MONTHS_WIDE = 18;
/** A phone has room for fewer bars at a readable size. */
const MONTHS_NARROW = 8;

const W_WIDE = 560;
const W_NARROW = 340;
const H = 190;
const PAD_L = 44;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;

/**
 * "Where did my buying money come from?" Each purchase is funded by earlier
 * sale proceeds first, and only the rest is new money from you. The bars
 * split every month's buying that way; the tiles give the lifetime view.
 *
 * Server-rendered: hover text uses native SVG titles, so it ships no
 * client JavaScript.
 */
export function CapitalCard({
  flow,
  currency,
  totalProfit,
  skipped,
}: {
  flow: CapitalFlow;
  currency: string;
  /** Realized + unrealized profit, the dashboard's "Total profit". */
  totalProfit: number;
  /** Transactions left out for lack of an exchange rate. */
  skipped: number;
}) {
  if (flow.spent === 0) return null;

  // Profit per unit of YOUR money. Rolled-over proceeds are not extra
  // capital, so the base is own money only.
  const returnOnOwn =
    flow.ownMoneyIn > 0 ? totalProfit / flow.ownMoneyIn : null;

  return (
    <Card className="p-4">
      <h2 className="font-medium text-sm">
        Where your buying money came from{" "}
        <span className="text-xs text-zinc-500 font-normal">
          whole portfolio
        </span>
      </h2>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Tile
          label="Your own money in"
          hint={`of ${formatCompactAmount(flow.spent, currency)} spent in total`}
        >
          <Money amount={flow.ownMoneyIn} currency={currency} />
        </Tile>
        <Tile
          label="Rolled over from sales"
          hint={
            flow.selfFundedPct != null
              ? `${Math.round(flow.selfFundedPct * 100)}% of everything you bought`
              : undefined
          }
        >
          <Money amount={flow.rolled} currency={currency} />
        </Tile>
        <Tile
          label="Sale proceeds not reinvested"
          hint="taken out, or waiting to be spent"
        >
          <Money amount={flow.pool} currency={currency} />
        </Tile>
        <Tile
          label="Profit on your own money"
          hint="total profit ÷ own money in"
        >
          {returnOnOwn == null ? (
            "—"
          ) : (
            <span className={tone(returnOnOwn)}>{pct(returnOnOwn)}</span>
          )}
        </Tile>
      </dl>

      <details className="mt-4">
        <summary className="cursor-pointer select-none text-xs text-sky-700 dark:text-sky-400 hover:underline">
          Month by month
        </summary>
        <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
          <Key color="bg-sky-500" label="New money" />
          <Key color="bg-emerald-500" label="Rolled over from sales" />
          <span className="ml-auto hidden sm:inline">hover a bar</span>
        </div>

        <div className="hidden sm:block">
          <Chart
            months={lastMonths(flow.months, MONTHS_WIDE)}
            width={W_WIDE}
            currency={currency}
          />
        </div>
        <div className="sm:hidden">
          <Chart
            months={lastMonths(flow.months, MONTHS_NARROW)}
            width={W_NARROW}
            currency={currency}
          />
        </div>
      </details>

      <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
        Sale proceeds are pooled across all items and spent on the next
        purchases first. Anything entered at the same moment counts sales first.
        {skipped > 0 &&
          ` ${skipped} transaction${skipped === 1 ? "" : "s"} in another currency left out (no exchange rate).`}
      </p>
    </Card>
  );
}

function Chart({
  months,
  width,
  currency,
}: {
  months: CapitalMonth[];
  width: number;
  currency: string;
}) {
  const totals = months.map((m) => m.fresh + m.rolled);
  // One dominant month would flatten every other bar; cap it and mark it.
  const { max: capMax } = capMagnitude(totals);
  const domain = niceDomain(capMax, 0);
  const plotW = width - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const colW = plotW / months.length;
  const barW = Math.min(28, colW * 0.62);
  const y = (v: number) =>
    PAD_T + (1 - Math.min(v, domain.hi) / domain.hi) * plotH;
  const stride = months.length > 10 ? 2 : 1;

  return (
    <svg
      viewBox={`0 0 ${width} ${H}`}
      className="mt-1 block w-full select-none"
      role="img"
      aria-label={`Monthly buying for the last ${months.length} months, split into new money and money rolled over from sales`}
    >
      {domain.ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={width - PAD_R}
            y1={y(t)}
            y2={y(t)}
            className={
              t === 0
                ? "stroke-zinc-400 dark:stroke-zinc-500"
                : "stroke-zinc-200 dark:stroke-zinc-800"
            }
            strokeWidth={1}
          />
          <text
            x={PAD_L - 6}
            y={y(t) + 3}
            textAnchor="end"
            className="fill-zinc-500 text-[9px] tabular-nums"
          >
            {t === 0 ? "0" : formatCompactAmount(t, currency)}
          </text>
        </g>
      ))}

      {months.map((m, i) => {
        const cx = PAD_L + (i + 0.5) * colW;
        const total = m.fresh + m.rolled;
        const freshTop = y(m.fresh);
        const rolledTop = y(m.fresh + m.rolled);
        const cut = total > domain.hi;
        const showLabel = (months.length - 1 - i) % stride === 0;
        const [name] = formatMonthShort(m.month).split(" ");
        const showYear = m.month.endsWith("-01") || i === 0;
        const tip =
          `${formatMonthLong(m.month)}\n` +
          `Bought ${formatAmount(total, currency)}: ` +
          `${formatAmount(m.fresh, currency)} new money, ` +
          `${formatAmount(m.rolled, currency)} rolled over\n` +
          `Sold ${formatAmount(m.proceeds, currency)}\n` +
          `Own money in so far ${formatAmount(m.ownMoneyIn, currency)}`;
        return (
          <g key={m.month}>
            <title>{tip}</title>
            {/* Full-height hit area so thin bars are easy to hover. */}
            <rect
              x={cx - colW / 2}
              y={PAD_T}
              width={colW}
              height={plotH}
              fill="transparent"
            />
            {m.fresh > 0 && (
              <rect
                x={cx - barW / 2}
                y={freshTop}
                width={barW}
                height={Math.max(0, y(0) - freshTop)}
                rx={1.5}
                className="fill-sky-500"
              />
            )}
            {m.rolled > 0 && (
              <rect
                x={cx - barW / 2}
                y={rolledTop}
                width={barW}
                height={Math.max(0, freshTop - rolledTop)}
                rx={1.5}
                className="fill-emerald-500"
              />
            )}
            {cut && (
              <line
                x1={cx - barW / 2 - 2}
                x2={cx + barW / 2 + 2}
                y1={PAD_T + 9}
                y2={PAD_T + 4}
                strokeWidth={2.5}
                className="stroke-white dark:stroke-zinc-900"
              />
            )}
            {showLabel && (
              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                className="fill-zinc-500 text-[9px]"
              >
                {name}
                {showYear && ` '${m.month.slice(2, 4)}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Tile({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight truncate">
        {children}
      </dd>
      {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2.5 h-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  );
}
