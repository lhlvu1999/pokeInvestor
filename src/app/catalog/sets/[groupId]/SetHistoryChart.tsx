import { Card } from "@/components/ui";
import {
  changeOver,
  downsample,
  linePath,
  scaleSeries,
  sharedDomain,
  type Point,
} from "@/lib/calc/set_history";
import { changeLabel } from "@/lib/calc/set_list";
import { showUsd, type Fx } from "@/lib/calc/catalog_money";

/** A phone gets a narrower, taller drawing so the text stays readable. */
const SIZES = {
  wide: { W: 600, H: 170, PAD_L: 52 },
  narrow: { W: 340, H: 210, PAD_L: 46 },
} as const;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;
/** A year of daily points doesn't need to be drawn point by point. */
const MAX_POINTS = 240;

const MONTHS = [
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
const monthYear = (day: string) =>
  `${MONTHS[+day.slice(5, 7) - 1]} ${day.slice(0, 4)}`;

const tone = (c: number | null) =>
  c == null
    ? "text-zinc-400"
    : c > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : c < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-zinc-500";

/**
 * How a set's value has moved: the whole set (one of each card) and its top
 * twenty cards over time, with the change over a month, a quarter and a year.
 * Server-rendered SVG, so it ships no client JavaScript.
 */
export function SetHistoryChart({
  total,
  top20,
  measured,
  fx,
}: {
  total: Point[];
  top20: Point[];
  /** The series the change figures are taken from (well-covered days only). */
  measured: Point[];
  fx: Fx | null;
}) {
  if (total.length < 2) return null;

  const first = total[0].day;
  const last = total[total.length - 1].day;
  const windows: { label: string; days: number }[] = [
    { label: "1 month", days: 30 },
    { label: "3 months", days: 90 },
    { label: "1 year", days: 365 },
  ];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="font-medium">
          Value over time{" "}
          <span className="text-xs font-normal text-zinc-500">
            {monthYear(first)} to {monthYear(last)}
          </span>
        </h2>
        <dl className="flex gap-4 text-xs">
          {windows.map((w) => {
            const c = changeOver(measured, w.days);
            return (
              <div key={w.label}>
                <dt className="text-zinc-500">{w.label}</dt>
                <dd className={`tabular-nums font-medium ${tone(c)}`}>
                  {changeLabel(c)}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      <div className="mt-3">
        <div className="hidden sm:block">
          <Drawing size="wide" total={total} top20={top20} fx={fx} />
        </div>
        <div className="sm:hidden">
          <Drawing size="narrow" total={total} top20={top20} fx={fx} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-sky-500" /> Whole set
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-emerald-500" />{" "}
          Top 20 cards
        </span>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
        Today&apos;s card list priced at each day&apos;s prices, so a card that
        didn&apos;t exist yet adds nothing before it came out.
      </p>
    </Card>
  );
}

function Drawing({
  size,
  total,
  top20,
  fx,
}: {
  size: keyof typeof SIZES;
  total: Point[];
  top20: Point[];
  fx: Fx | null;
}) {
  const { W, H, PAD_L } = SIZES[size];
  const domain = sharedDomain(total, top20)!;
  const inner = { w: W - PAD_L - PAD_R, h: H - PAD_T - PAD_B };
  const draw = (series: Point[]) =>
    linePath(
      scaleSeries(downsample(series, MAX_POINTS), inner.w, inner.h, domain).map(
        (p) => ({ x: p.x + PAD_L, y: p.y + PAD_T }),
      ),
    );
  const first = total[0].day;
  const last = total[total.length - 1].day;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Set value from ${monthYear(first)} to ${monthYear(last)}, now ${showUsd(total[total.length - 1].cents, fx, true).primary}`}
      className="w-full h-auto"
    >
      {[domain.max, (domain.max + domain.min) / 2, domain.min].map((v, i) => {
        const y = PAD_T + (i / 2) * inner.h;
        return (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y}
              y2={y}
              className="stroke-zinc-200 dark:stroke-zinc-800"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-zinc-500"
              fontSize={10}
            >
              {showUsd(v, fx, true).primary}
            </text>
          </g>
        );
      })}
      <path
        d={draw(top20)}
        fill="none"
        strokeWidth={1.75}
        strokeDasharray="4 3"
        className="stroke-emerald-500"
      />
      <path
        d={draw(total)}
        fill="none"
        strokeWidth={2}
        className="stroke-sky-500"
      />
      <text x={PAD_L} y={H - 6} className="fill-zinc-500" fontSize={10}>
        {monthYear(first)}
      </text>
      <text
        x={W - PAD_R}
        y={H - 6}
        textAnchor="end"
        className="fill-zinc-500"
        fontSize={10}
      >
        {monthYear(last)}
      </text>
    </svg>
  );
}
