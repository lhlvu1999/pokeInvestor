import Link from "next/link";
import { Card } from "@/components/ui";
import type { Signal } from "@/lib/server/signals";
import { describeLabel, type SignalLabel } from "@/lib/signals-shared";

/**
 * Leaderboard of items the recent insights have an opinion on. Each row is
 * the aggregate of every mention in the chosen time window for a given
 * (matched item | raw name). Labels apply the conservative thresholds
 * encoded in `src/lib/server/signals.ts#computeLabel`.
 */
export function TopSignals({ signals }: { signals: Signal[] }) {
  return (
    <div className="flex flex-col gap-2">
      {signals.map((s) => (
        <SignalRow key={s.key} signal={s} />
      ))}
    </div>
  );
}

function SignalRow({ signal: s }: { signal: Signal }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-4">
        {/* Identity */}
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            {s.itemId ? (
              <Link
                href={`/items/${s.itemId}`}
                className="font-medium hover:underline"
              >
                {s.displayName}
              </Link>
            ) : (
              <span className="font-medium">{s.displayName}</span>
            )}
            {s.label && <LabelChip label={s.label} />}
            {!s.itemId && (
              <span
                className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                title="No matching item in your portfolio. Resolve in admin to link."
              >
                unmatched
              </span>
            )}
          </div>
          {s.recommendation && (
            <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {s.recommendation}
            </div>
          )}
        </div>

        {/* Sentiment breakdown */}
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <SentimentBar
            bull={s.bullishCount}
            bear={s.bearishCount}
            neutral={s.neutralCount}
          />
          <div className="flex flex-col gap-0.5 text-[11px] text-zinc-500 whitespace-nowrap">
            <div>
              {s.mentionCount} mention{s.mentionCount === 1 ? "" : "s"}
            </div>
            <div>
              {s.sourceCount} source{s.sourceCount === 1 ? "" : "s"}
            </div>
            {s.avgConfidence !== null && (
              <div title="Average model confidence across mentions">
                conf {s.avgConfidence.toFixed(2)}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function LabelChip({ label }: { label: SignalLabel }) {
  const { text, tone } = describeLabel(label);
  const cls =
    tone === "bull"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300";
  return (
    <span
      className={`inline-flex items-center text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 font-medium ${cls}`}
    >
      {text}
    </span>
  );
}

/**
 * Horizontal stacked bar: bull (green) | neutral (zinc) | bear (rose).
 * Width proportional to count, with a 1px minimum so non-zero segments
 * are always visible.
 */
function SentimentBar({
  bull,
  bear,
  neutral,
}: {
  bull: number;
  bear: number;
  neutral: number;
}) {
  const total = bull + bear + neutral;
  if (total === 0) {
    return (
      <div className="w-32 h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800" />
    );
  }
  const pct = (n: number) => (n === 0 ? 0 : Math.max(2, (n / total) * 100));
  return (
    <div
      className="w-32 h-2.5 rounded-full overflow-hidden flex bg-zinc-200 dark:bg-zinc-800"
      title={`${bull} bullish · ${neutral} neutral · ${bear} bearish`}
    >
      {bull > 0 && (
        <div
          className="bg-emerald-500 h-full"
          style={{ width: `${pct(bull)}%` }}
        />
      )}
      {neutral > 0 && (
        <div
          className="bg-zinc-400 dark:bg-zinc-500 h-full"
          style={{ width: `${pct(neutral)}%` }}
        />
      )}
      {bear > 0 && (
        <div
          className="bg-rose-500 h-full"
          style={{ width: `${pct(bear)}%` }}
        />
      )}
    </div>
  );
}
