import { niceTicks } from "@/lib/calc/chart_scale";
import type { CurvePoint } from "@/lib/calc/age_curve";
import type { PathPoint } from "@/lib/calc/set_path";
import { downsample } from "@/lib/calc/set_history";

const SIZES = {
  wide: { W: 640, H: 260, PAD_L: 44 },
  narrow: { W: 340, H: 260, PAD_L: 40 },
} as const;
const PAD_R = 10;
const PAD_T = 8;
const PAD_B = 24;
const MAX_POINTS = 200;
const AGE_TICKS = [0, 30, 90, 180, 365, 540, 730];

/** Static class names, so Tailwind sees every one. */
export const COMPARE_COLORS = [
  "stroke-sky-500",
  "stroke-amber-500",
  "stroke-emerald-500",
  "stroke-rose-500",
  "stroke-violet-500",
] as const;
export const COMPARE_SWATCH = [
  "bg-sky-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-violet-500",
] as const;

const pct = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%`;

export type CompareLine = {
  label: string;
  stroke: string;
  points: PathPoint[];
};

/**
 * Several sets' paths by age on one scale, with the typical range of earlier
 * sets (the middle half) shaded behind them when given.
 */
export function CompareChart({
  lines,
  band,
  baseAge,
  size,
}: {
  lines: CompareLine[];
  band: CurvePoint[] | null;
  baseAge: number;
  size: keyof typeof SIZES;
}) {
  const drawn = lines.filter((l) => l.points.length > 1);
  if (drawn.length === 0) return null;

  const { W, H, PAD_L } = SIZES[size];
  const inner = { w: W - PAD_L - PAD_R, h: H - PAD_T - PAD_B };

  const ages = [
    ...drawn.flatMap((l) => l.points.map((p) => p.age)),
    ...(band ?? []).map((p) => p.age),
  ];
  const minAge = baseAge;
  const maxAge = Math.max(...ages, baseAge + 1);
  const spanAge = Math.max(1, maxAge - minAge);

  const values = [
    0,
    ...drawn.flatMap((l) => l.points.map((p) => p.change)),
    ...(band ?? []).flatMap((p) => [p.p25, p.p75]),
  ];
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (age: number) => PAD_L + ((age - minAge) / spanAge) * inner.w;
  const y = (v: number) =>
    PAD_T +
    (hi === lo ? inner.h / 2 : inner.h - ((v - lo) / (hi - lo)) * inner.h);

  const path = (pts: { x: number; y: number }[]) =>
    pts
      .map(
        (p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
      )
      .join(" ");
  const bandPath =
    band && band.length > 1
      ? `${path(band.map((p) => ({ x: x(p.age), y: y(p.p75) })))} ${[...band]
          .reverse()
          .map((p) => `L${x(p.age).toFixed(1)},${y(p.p25).toFixed(1)}`)
          .join(" ")} Z`
      : null;
  const medianPath =
    band && band.length > 1
      ? path(band.map((p) => ({ x: x(p.age), y: y(p.median) })))
      : null;

  const MIN_LABEL_GAP = size === "wide" ? 46 : 40;
  const ageTicks: number[] = [];
  for (const a of AGE_TICKS) {
    if (a < minAge || a > maxAge) continue;
    const prev = ageTicks[ageTicks.length - 1];
    if (prev === undefined || x(a) - x(prev) >= MIN_LABEL_GAP) ageTicks.push(a);
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Change in value by days since release, from ${baseAge === 0 ? "release day" : `day ${baseAge}`}: ${drawn
        .map((l) => `${l.label} ${pct(l.points[l.points.length - 1].change)}`)
        .join("; ")}`}
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
              t === 0
                ? "stroke-zinc-400 dark:stroke-zinc-600"
                : "stroke-zinc-200 dark:stroke-zinc-800"
            }
            strokeWidth={1}
            strokeDasharray={t === 0 ? "3 3" : undefined}
          />
          <text
            x={PAD_L - 6}
            y={y(t) + 3}
            textAnchor="end"
            className="fill-zinc-500"
            fontSize={10}
          >
            {pct(t)}
          </text>
        </g>
      ))}
      {ageTicks.map((a) => (
        <text
          key={a}
          x={x(a)}
          y={H - 8}
          textAnchor={a === minAge ? "start" : a === maxAge ? "end" : "middle"}
          className="fill-zinc-500"
          fontSize={10}
        >
          {a === 0
            ? "release"
            : a < 365
              ? `${a}d`
              : `${(a / 365).toFixed(a % 365 === 0 ? 0 : 1)}y`}
        </text>
      ))}
      {bandPath && (
        <path d={bandPath} className="fill-zinc-500" opacity={0.15} />
      )}
      {medianPath && (
        <path
          d={medianPath}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          className="stroke-zinc-500"
        />
      )}
      {drawn.map((l) => (
        <path
          key={l.label}
          d={path(
            downsample(l.points, MAX_POINTS).map((p) => ({
              x: x(p.age),
              y: y(p.change),
            })),
          )}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className={l.stroke}
        />
      ))}
    </svg>
  );
}
