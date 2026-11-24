import Link from "next/link";
import { AGES, pointAt, type CurvePoint } from "@/lib/calc/age_curve";
import { changeLabel } from "@/lib/calc/set_list";

/** Ages shown in the summary table (when the chosen base is before them). */
const TABLE_AGES = [30, 90, 180, 365, 540];

export const EN_LINE = { stroke: "stroke-sky-500", fill: "fill-sky-500" };
export const JA_LINE = { stroke: "stroke-amber-500", fill: "fill-amber-500" };

export const tone = (c: number | null) =>
  c == null
    ? "text-zinc-400"
    : c > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : c < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-zinc-500";

export function Chips({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500 w-full sm:w-28 sm:shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

export function Chip({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={on ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-xs ${
        on
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </Link>
  );
}

export function Legend({
  items,
  note,
}: {
  items: { label: string; stroke: string; dashed?: boolean }[];
  note?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-500">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden>
            <line
              x1="0"
              x2="22"
              y1="3"
              y2="3"
              strokeWidth="2"
              strokeDasharray={i.dashed ? "5 3" : undefined}
              className={i.stroke}
            />
          </svg>
          {i.label}
        </span>
      ))}
      {note && <span className="text-[11px]">{note}</span>}
    </div>
  );
}

export function AgeTable({
  rows,
  baseAge,
}: {
  rows: { label: string; curve: CurvePoint[] }[];
  baseAge: number;
}) {
  const ages = TABLE_AGES.filter((a) => a > baseAge && AGES.includes(a));
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-xs sm:text-sm">
        <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="py-2 pr-2 sm:pr-3 text-left font-medium"></th>
            {ages.map((a) => (
              <th
                key={a}
                className="px-1 sm:px-3 py-2 text-right font-medium"
              >
                <span className="sm:hidden">
                  {a < 365 ? `${a}d` : a === 365 ? "1y" : "18m"}
                </span>
                <span className="hidden sm:inline">
                  {a < 365 ? `${a} days` : a === 365 ? "1 year" : "18 months"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-2 pr-2 sm:pr-3 font-medium whitespace-nowrap">
                {r.label}
              </td>
              {ages.map((a) => {
                const p = pointAt(r.curve, a);
                return (
                  <td key={a} className="px-1 sm:px-3 py-2 text-right tabular-nums">
                    {p ? (
                      <>
                        <span className={tone(p.median)}>
                          {changeLabel(p.median)}
                        </span>
                        <div className="text-[11px] text-zinc-500">
                          {p.sets} sets
                          <span className="hidden sm:inline">
                            {` · ${Math.round(p.shareUp * 100)}% up`}
                          </span>
                        </div>
                      </>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

