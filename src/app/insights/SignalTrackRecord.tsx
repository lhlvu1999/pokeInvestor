import Link from "next/link";
import { ItemLink } from "@/components/ItemDrawer";
import { Card } from "@/components/ui";
import { pct, tone } from "@/lib/calc/format_delta";
import {
  HORIZON_OPTIONS,
  MIN_CREATOR_CALLS,
  THRESHOLD_OPTIONS,
  type TrackRecord,
} from "@/lib/calc/signal_track";

/** A rate on fewer scored calls than this is more luck than skill. */
const SMALL_SAMPLE = 30;

const whole = (f: number | null) =>
  f == null ? "—" : `${Math.round(f * 100)}%`;

function day(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${
    [
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
    ][d.getUTCMonth()]
  } '${String(d.getUTCFullYear()).slice(2)}`;
}

/**
 * Did the creators' calls turn out right? Shows the STRICT hit rate first —
 * the call moved the right way by at least the threshold — then the
 * generous direction-only rate, then what a random pick would have scored,
 * so the number can be judged instead of just admired.
 */
export function SignalTrackRecord({
  record,
  historyFrom,
  undatedVideos,
  horizonDays,
  baseQuery,
}: {
  record: TrackRecord;
  historyFrom: number | null;
  undatedVideos: number;
  horizonDays: number;
  /** Current query string; the switches overwrite their own keys in it. */
  baseQuery: string;
}) {
  const r = record;
  const thr = Math.round(r.params.threshold * 100);
  const edge =
    r.strictRate != null && r.baseRate != null
      ? r.strictRate - r.baseRate
      : null;

  const href = (key: "horizon" | "move", value: number) => {
    const q = new URLSearchParams(baseQuery);
    q.set(key, String(value));
    return `?${q.toString()}`;
  };

  // The four outcomes add up to every scored call.
  const smallRight = r.rightWay - r.hits;
  const smallWrong = r.scored - r.rightWay - r.clearMisses;
  const segments = [
    { n: r.hits, cls: "bg-emerald-500", label: `Hit: right way by ${thr}%+` },
    {
      n: smallRight,
      cls: "bg-emerald-300 dark:bg-emerald-800",
      label: `Right way, under ${thr}%`,
    },
    {
      n: smallWrong,
      cls: "bg-zinc-300 dark:bg-zinc-600",
      label: "Flat or slightly wrong",
    },
    { n: r.clearMisses, cls: "bg-rose-500", label: `Wrong way by ${thr}%+` },
  ];

  return (
    <Card className="p-4 sm:p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-zinc-500 max-w-prose">
          Each bullish or bearish call on an item you track, checked against
          that item&apos;s price {horizonDays} days after the video. Independent
          of the filters above.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Switch label="Days after video">
            {HORIZON_OPTIONS.map((h) => (
              <SwitchLink
                key={h}
                href={href("horizon", h)}
                active={h === horizonDays}
              >
                {h}d
              </SwitchLink>
            ))}
          </Switch>
          <Switch label="Hit means moved">
            {THRESHOLD_OPTIONS.map((t) => (
              <SwitchLink
                key={t}
                href={href("move", Math.round(t * 100))}
                active={Math.round(t * 100) === thr}
              >
                {Math.round(t * 100)}%+
              </SwitchLink>
            ))}
          </Switch>
        </div>
      </div>

      {r.scored === 0 ? (
        <p className="text-sm text-zinc-500 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4">
          None of the {r.total} calls could be scored yet — see below for why.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                Strict hit rate
              </div>
              <div className="mt-1 text-4xl font-semibold tabular-nums tracking-tight leading-none">
                {whole(r.strictRate)}
              </div>
              <div className="text-xs text-zinc-500 mt-1.5">
                {r.hits} of {r.scored} calls moved the right way by {thr}%+
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                Right direction
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight leading-none text-zinc-600 dark:text-zinc-300">
                {whole(r.directionRate)}
              </div>
              <div className="text-xs text-zinc-500 mt-1.5">
                any move the called way, however small
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                A random pick would hit
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight leading-none text-zinc-600 dark:text-zinc-300">
                {whole(r.baseRate)}
              </div>
              <div className="text-xs mt-1.5">
                {edge == null ? (
                  <span className="text-zinc-500">no comparison yet</span>
                ) : (
                  <span className={tone(edge)}>
                    {pct(edge).replace("%", " pts")}{" "}
                    <span className="text-zinc-500">
                      {edge > 0 ? "better" : edge < 0 ? "worse" : "same"} than
                      random
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {r.scored < SMALL_SAMPLE && (
            <p className="text-xs text-amber-700 dark:text-amber-400 rounded-md bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
              Only {r.scored} calls scored. Treat these rates as a first look,
              not a verdict — a handful of lucky calls can swing them a lot.
            </p>
          )}

          <div>
            <div
              className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
              role="img"
              aria-label={segments.map((s) => `${s.label}: ${s.n}`).join(", ")}
            >
              {segments.map(
                (s) =>
                  s.n > 0 && (
                    <div
                      key={s.label}
                      className={s.cls}
                      style={{ width: `${(s.n / r.scored) * 100}%` }}
                      title={`${s.label}: ${s.n}`}
                    />
                  ),
              )}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
              {segments.map((s) => (
                <li key={s.label} className="inline-flex items-center gap-1.5">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-sm ${s.cls}`}
                  />
                  {s.label}
                  <span className="tabular-nums text-zinc-400">{s.n}</span>
                </li>
              ))}
            </ul>
          </div>

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Split label="Bullish calls" t={r.bullish} />
            <Split label="Bearish calls" t={r.bearish} />
          </dl>
        </>
      )}

      <p className="text-[11px] text-zinc-500 leading-relaxed">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">
          {r.scored} of {r.total} calls scored.
        </span>{" "}
        {[
          r.notScored.noBaseline > 0 &&
            `${r.notScored.noBaseline} had no price within ${r.params.maxGapDays} days before the video${historyFrom != null ? ` (price history starts ${day(historyFrom)})` : ""}`,
          r.notScored.noOutcome > 0 &&
            `${r.notScored.noOutcome} had no price near the ${horizonDays}-day mark`,
          r.notScored.tooRecent > 0 &&
            `${r.notScored.tooRecent} are too recent to judge`,
        ]
          .filter(Boolean)
          .join(" · ")}
        {undatedVideos > 0 &&
          `${r.total === r.scored ? "" : " · "}${undatedVideos} video${undatedVideos === 1 ? "" : "s"} have no upload date and are left out, since the call can't be placed in time.`}{" "}
        One video counts once per item. Prices are market estimates, so small
        moves can be noise.
      </p>

      {r.creators.length > 0 && (
        <div>
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">
            By creator
          </h3>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-1 py-2 text-left font-medium">Creator</th>
                  <th className="px-1 py-2 text-right font-medium">Scored</th>
                  <th className="px-1 py-2 text-right font-medium">Strict</th>
                  <th className="px-1 py-2 text-right font-medium">
                    Direction
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {r.creators.slice(0, 10).map((c) => (
                  <tr
                    key={c.channelId}
                    className={c.thin ? "text-zinc-400" : ""}
                  >
                    <td className="px-1 py-2">
                      <a
                        href={`https://www.youtube.com/channel/${c.channelId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {c.channelTitle}
                      </a>
                      {c.thin && (
                        <span
                          className="ml-2 text-[10px] text-zinc-400"
                          title={`Fewer than ${MIN_CREATOR_CALLS} scored calls`}
                        >
                          few calls
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums">
                      {c.scored}
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums font-medium">
                      {whole(c.strictRate)}
                      <span className="text-xs font-normal text-zinc-400 ml-1">
                        ({c.hits})
                      </span>
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums">
                      {whole(c.scored > 0 ? c.rightWay / c.scored : null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {r.recent.length > 0 && (
        <div>
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">
            Latest scored calls
          </h3>
          <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800 text-sm">
            {r.recent.map((c) => (
              <li
                key={`${c.signal.videoId}-${c.signal.itemId}`}
                className="flex items-baseline justify-between gap-3 py-1.5"
              >
                <span className="min-w-0">
                  <ItemLink
                    itemId={c.signal.itemId}
                    className="hover:underline line-clamp-1"
                  >
                    {c.signal.itemName}
                  </ItemLink>
                  <span className="block text-[11px] text-zinc-500">
                    <span
                      className={
                        c.signal.direction === "bullish"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }
                    >
                      {c.signal.direction}
                    </span>{" "}
                    · {c.signal.channelTitle} · {day(c.signal.at.getTime())}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className={tone(c.movePct)}>{pct(c.movePct)}</span>
                  <span
                    className={`ml-2 text-xs font-medium ${
                      c.hit
                        ? "text-emerald-600 dark:text-emerald-400"
                        : verdict(c, r.params.threshold) === "miss"
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-zinc-500"
                    }`}
                  >
                    {verdict(c, r.params.threshold)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** hit / small (right way, under the bar) / flat / miss (clearly wrong). */
function verdict(
  c: TrackRecord["recent"][number],
  threshold: number,
): "hit" | "small" | "flat" | "miss" {
  if (c.hit) return "hit";
  if (c.rightWay) return "small";
  const signed = c.signal.direction === "bullish" ? c.movePct : -c.movePct;
  return signed <= -threshold ? "miss" : "flat";
}

function Switch({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 bg-zinc-50 dark:bg-zinc-800/50"
      >
        {children}
      </div>
    </div>
  );
}

function SwitchLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
        active
          ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium"
          : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </Link>
  );
}

function Split({
  label,
  t,
}: {
  label: string;
  t: { scored: number; hits: number; strictRate: number | null };
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </dt>
      <dd className="mt-0.5 font-semibold tabular-nums">
        {whole(t.strictRate)}{" "}
        <span className="text-xs font-normal text-zinc-500">
          strict · {t.scored} scored
        </span>
      </dd>
    </div>
  );
}
