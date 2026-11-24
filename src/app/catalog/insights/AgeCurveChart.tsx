import { niceTicks } from "@/lib/calc/chart_scale";
import type { CurvePoint } from "@/lib/calc/age_curve";

const SIZES = {
  wide: { W: 640, H: 240, PAD_L: 44 },
  narrow: { W: 340, H: 250, PAD_L: 40 },
} as const;
const PAD_R = 10;
const PAD_T = 8;
const PAD_B = 24;

/** Where to label the age axis, in days since release. */
const AGE_TICKS = [0, 30, 90, 180, 365, 540, 730];

const pct = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%`;

export type AgeLine = {
  label: string;
  points: CurvePoint[];
  /** Tailwind stroke / fill classes. */
  stroke: string;
  fill: string;
};

/**
 * The typical path after release: a line for the median set with a shaded
 * band from the 25th to the 75th percentile, so how much sets differ is
 * visible and not only the middle.
 */
export function AgeCurveChart({
  lines,
  size,
}: {
  lines: AgeLine[];
  size: keyof typeof SIZES;
}) {
  const drawn = lines.filter((l) => l.points.length > 1);
  if (drawn.length === 0) return null;

  const { W, H, PAD_L } = SIZES[size];
  const inner = { w: W - PAD_L - PAD_R, h: H - PAD_T - PAD_B };

  const all = drawn.flatMap((l) => l.points);
  const minAge = Math.min(...all.map((p) => p.age));
  const maxAge = Math.max(...all.map((p) => p.age));
  const spanAge = Math.max(1, maxAge - minAge);

  const ticks = niceTicks(
    Math.min(0, ...all.map((p) => p.p25)),
    Math.max(0, ...all.map((p) => p.p75)),
    4,
  );
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (age: number) => PAD_L + ((age - minAge) / spanAge) * inner.w;
  const y = (v: number) =>
    PAD_T +
    (hi === lo ? inner.h / 2 : inner.h - ((v - lo) / (hi - lo)) * inner.h);

  const line = (pts: CurvePoint[], pick: (p: CurvePoint) => number) =>
    pts
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${x(p.age).toFixed(1)},${y(pick(p)).toFixed(1)}`,
      )
      .join(" ");
  const band = (pts: CurvePoint[]) =>
    `${line(pts, (p) => p.p75)} ${[...pts]
      .reverse()
      .map((p) => `L${x(p.age).toFixed(1)},${y(p.p25).toFixed(1)}`)
      .join(" ")} Z`;

  // Skip a label that would sit on top of the previous one ("release" and
  // "30d" are close together at the left edge).
  const MIN_LABEL_GAP = size === "wide" ? 46 : 40;
  const ageTicks: number[] = [];
  for (const a of AGE_TICKS) {
    if (a < minAge || a > maxAge) continue;
    const prev = ageTicks[ageTicks.length - 1];
    if (prev === undefined || x(a) - x(prev) >= MIN_LABEL_GAP) ageTicks.push(a);
  }
  const desc = drawn
    .map((l) => {
      const end = l.points[l.points.length - 1];
      return `${l.label}: median ${pct(end.median)} at ${end.age} days`;
    })
    .join("; ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Change in price by days since release. ${desc}`}
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
      {drawn.map((l) => (
        <g key={l.label}>
          <path d={band(l.points)} className={l.fill} opacity={0.14} />
          <path
            d={line(l.points, (p) => p.median)}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            className={l.stroke}
          />
        </g>
      ))}
    </svg>
  );
}
