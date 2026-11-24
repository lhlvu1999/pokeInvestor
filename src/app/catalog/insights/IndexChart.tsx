import { niceTicks } from "@/lib/calc/chart_scale";
import type { IndexPoint } from "@/lib/calc/market_index";
import { daysBetween, downsample } from "@/lib/calc/set_history";

const SIZES = {
  wide: { W: 640, H: 220, PAD_L: 40 },
  narrow: { W: 340, H: 240, PAD_L: 36 },
} as const;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;
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

export type IndexLine = {
  label: string;
  points: IndexPoint[];
  /** Tailwind stroke class. */
  stroke: string;
  dashed?: boolean;
};

/**
 * One or more index lines on a shared scale, all already starting at 100 on
 * the same day. A flat line at 100 is "no change since the start".
 */
export function IndexChart({
  lines,
  size,
}: {
  lines: IndexLine[];
  size: keyof typeof SIZES;
}) {
  const drawn = lines.filter((l) => l.points.length > 1);
  if (drawn.length === 0) return null;

  const { W, H, PAD_L } = SIZES[size];
  const inner = { w: W - PAD_L - PAD_R, h: H - PAD_T - PAD_B };

  const all = drawn.flatMap((l) => l.points);
  const first = all.reduce((a, p) => (p.day < a ? p.day : a), all[0].day);
  const last = all.reduce((a, p) => (p.day > a ? p.day : a), all[0].day);
  const span = Math.max(1, daysBetween(first, last));

  const ticks = niceTicks(
    Math.min(100, ...all.map((p) => p.value)),
    Math.max(100, ...all.map((p) => p.value)),
    4,
  );
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (day: string) => PAD_L + (daysBetween(first, day) / span) * inner.w;
  const y = (v: number) =>
    PAD_T +
    (hi === lo ? inner.h / 2 : inner.h - ((v - lo) / (hi - lo)) * inner.h);

  const path = (points: IndexPoint[]) =>
    downsample(points, MAX_POINTS)
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`,
      )
      .join(" ");

  const desc = drawn
    .map((l) => {
      const end = l.points[l.points.length - 1].value;
      return `${l.label} ${end.toFixed(0)}`;
    })
    .join(", ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Index from ${monthYear(first)} to ${monthYear(last)}, starting at 100: ${desc}`}
      className="w-full h-auto"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(t)}
            y2={y(t)}
            className={
              t === 100
                ? "stroke-zinc-400 dark:stroke-zinc-600"
                : "stroke-zinc-200 dark:stroke-zinc-800"
            }
            strokeWidth={1}
            strokeDasharray={t === 100 ? "3 3" : undefined}
          />
          <text
            x={PAD_L - 6}
            y={y(t) + 3}
            textAnchor="end"
            className="fill-zinc-500"
            fontSize={10}
          >
            {Math.round(t)}
          </text>
        </g>
      ))}
      {drawn.map((l) => (
        <path
          key={l.label}
          d={path(l.points)}
          fill="none"
          strokeWidth={2}
          strokeDasharray={l.dashed ? "5 3" : undefined}
          strokeLinejoin="round"
          className={l.stroke}
        />
      ))}
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
