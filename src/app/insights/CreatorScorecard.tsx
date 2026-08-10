import { Card } from "@/components/ui";
import type { CreatorScore } from "@/lib/server/creator_scores";

/**
 * Ranks channels by mention volume in the window. Shows match rate,
 * sentiment skew, and avg confidence so the user can tell "loud but
 * generic" apart from "focused and matches items I hold".
 */
export function CreatorScorecard({ scores }: { scores: CreatorScore[] }) {
  if (scores.length === 0) {
    return (
      <Card className="p-4 text-sm text-zinc-500">
        No creators produced insights in this window.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Creator</th>
              <th className="px-4 py-2 text-right font-medium">Videos</th>
              <th className="px-4 py-2 text-right font-medium">Mentions</th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="Share of mentions the matcher tied to an item you track."
              >
                Match rate
              </th>
              <th className="px-4 py-2 text-right font-medium">Sentiment</th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="Net = (bullish − bearish) ÷ mentions. +1 = only bullish; −1 = only bearish."
              >
                Net
              </th>
              <th
                className="px-4 py-2 text-right font-medium"
                title="Average of the LLM-reported per-mention confidence."
              >
                Confidence
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {scores.map((s) => {
              const matchPct =
                s.mentions === 0 ? 0 : (s.matchedMentions / s.mentions) * 100;
              const net =
                s.mentions === 0 ? 0 : (s.bullish - s.bearish) / s.mentions;
              const netColor =
                net > 0.15
                  ? "text-emerald-600 dark:text-emerald-400"
                  : net < -0.15
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-zinc-500";
              return (
                <tr
                  key={s.channelId}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                >
                  <td className="px-4 py-2.5">
                    <a
                      href={`https://www.youtube.com/channel/${s.channelId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline"
                    >
                      {s.channelTitle}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {s.videos}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                    {s.mentions}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span
                      className={
                        matchPct >= 40
                          ? "text-emerald-600 dark:text-emerald-400"
                          : matchPct >= 15
                            ? ""
                            : "text-zinc-400"
                      }
                    >
                      {matchPct.toFixed(0)}%
                    </span>
                    <span className="text-xs text-zinc-500 ml-1">
                      ({s.matchedMentions})
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {s.bullish}
                    </span>
                    <span className="text-zinc-400"> / </span>
                    <span className="text-zinc-500">{s.neutral}</span>
                    <span className="text-zinc-400"> / </span>
                    <span className="text-rose-600 dark:text-rose-400">
                      {s.bearish}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums font-medium ${netColor}`}
                  >
                    {net > 0 ? "+" : ""}
                    {net.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">
                    {s.avgConfidence == null ? "—" : s.avgConfidence.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
