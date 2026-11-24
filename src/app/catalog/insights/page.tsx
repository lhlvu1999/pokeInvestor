export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import { AgeCurveChart, type AgeLine } from "./AgeCurveChart";
import { CardAges } from "./CardAges";
import { StockTiming } from "./StockTiming";
import {
  AgeTable,
  Chip,
  Chips,
  EN_LINE,
  JA_LINE,
  Legend,
  tone,
} from "./parts";
import { IndexChart, type IndexLine } from "./IndexChart";
import { BASE_AGES, ageCurve } from "@/lib/calc/age_curve";
import {
  INDEX_METRIC_VALUES,
  insightHref,
  parseInsightParams,
  type IndexMetric,
} from "@/lib/calc/insight_params";
import {
  indexChange,
  maxDrawdown,
  rebaseTogether,
} from "@/lib/calc/market_index";
import { SEALED_TYPE_LABELS, SEALED_TYPES } from "@/lib/calc/sealed_type";
import { changeLabel } from "@/lib/calc/set_list";
import { getStockTiming } from "@/lib/server/catalog_lifecycle";
import { getDisplayCurrency } from "@/lib/server/settings";
import {
  getAgedProducts,
  getAgedSets,
  getMarketIndexes,
  type IndexSeries,
} from "@/lib/server/catalog_insights";

const METRIC_LABELS: Record<IndexMetric, string> = {
  sealed_all: "All sealed",
  box: "Booster boxes",
  etb: "Elite Trainer Boxes",
  bundle: "Booster bundles",
  pack: "Booster packs",
  set_total: "Set value",
  set_top20: "Top 20 cards",
};

const BASE_LABELS: Record<number, string> = {
  0: "Release day",
  7: "Day 7",
  30: "Day 30",
};


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

/**
 * Two views of the catalogue's history. The market index says how the typical
 * set or sealed product has moved, in English and Japanese. The age curves say
 * how a sealed product's price typically changes in the weeks and months after
 * its set is released. Choices live in the URL.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseInsightParams(await searchParams);
  const [market, aged, cardSets, stock] = await Promise.all([
    getMarketIndexes(),
    getAgedProducts(),
    getAgedSets(),
    getDisplayCurrency().then((c) => getStockTiming(c)),
  ]);

  if (market.series.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight">Set insights</h1>
        <Card className="p-6 text-sm">
          <div className="font-medium">There is no history yet</div>
          <p className="mt-1 text-zinc-600 dark:text-zinc-300 max-w-prose">
            These charts need the daily catalogue history. Fill it with:
          </p>
          <pre className="mt-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3 text-xs overflow-x-auto">
            cd pipeline && uv run poke-pipeline catalog-backfill
          </pre>
        </Card>
      </div>
    );
  }

  const find = (language: "en" | "ja") =>
    market.series.find(
      (s) => s.metric === params.metric && s.language === language,
    );
  const en = find("en");
  const ja = find("ja");
  const rebased = rebaseTogether([en?.points ?? [], ja?.points ?? []]);

  const lines: IndexLine[] = [];
  if (rebased) {
    if (en) {
      lines.push({
        label: "English",
        points: rebased.series[0],
        ...EN_LINE,
      });
    }
    if (ja) {
      lines.push({
        label: "Japanese",
        points: rebased.series[1],
        ...JA_LINE,
        dashed: true,
      });
    }
  }

  const curves = {
    en: ageCurve(aged, {
      type: params.kind,
      baseAge: params.base,
      language: "en",
    }),
    ja: ageCurve(aged, {
      type: params.kind,
      baseAge: params.base,
      language: "ja",
    }),
  };
  const ageLines: AgeLine[] = [];
  if (curves.en.length > 1) {
    ageLines.push({ label: "English", points: curves.en, ...EN_LINE });
  }
  if (curves.ja.length > 1) {
    ageLines.push({ label: "Japanese", points: curves.ja, ...JA_LINE });
  }
  const setsBehind = (language: "en" | "ja") =>
    new Set(
      aged
        .filter((p) => p.type === params.kind && p.language === language)
        .map((p) => p.groupId),
    ).size;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set insights</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          How the market has moved, built from the daily catalogue history
          {market.asOf ? ` (through ${monthYear(market.asOf)})` : ""}. These
          describe what already happened; they are not a forecast.
        </p>
      </div>

      <StockTiming data={stock} />

      {/* ---------------------------------------------------------- */}
      <Card className="p-4">
        <h2 className="font-medium">Market index</h2>
        <p className="text-xs text-zinc-500 mt-0.5 max-w-prose">
          How the typical {params.metric.startsWith("set_") ? "set" : "product"}{" "}
          has moved. 100 is the first day shown.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <Chips label="Sealed products">
            {INDEX_METRIC_VALUES.filter((m) => !m.startsWith("set_")).map(
              (m) => (
                <Chip
                  key={m}
                  href={insightHref(params, { metric: m })}
                  on={params.metric === m}
                >
                  {METRIC_LABELS[m]}
                </Chip>
              ),
            )}
          </Chips>
          <Chips label="Cards">
            {INDEX_METRIC_VALUES.filter((m) => m.startsWith("set_")).map(
              (m) => (
                <Chip
                  key={m}
                  href={insightHref(params, { metric: m })}
                  on={params.metric === m}
                >
                  {METRIC_LABELS[m]}
                </Chip>
              ),
            )}
          </Chips>
        </div>

        {lines.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            Not enough history for {METRIC_LABELS[params.metric].toLowerCase()}{" "}
            yet.
          </p>
        ) : (
          <>
            <div className="mt-4">
              <div className="hidden sm:block">
                <IndexChart lines={lines} size="wide" />
              </div>
              <div className="sm:hidden">
                <IndexChart lines={lines} size="narrow" />
              </div>
            </div>
            <Legend
              items={lines.map((l) => ({
                label: l.label,
                stroke: l.stroke,
                dashed: l.dashed,
              }))}
            />
            {rebased && ja && en && (
              <p className="mt-1 text-[11px] text-zinc-500">
                Both lines are set to 100 on {monthYear(rebased.day)}, when the
                Japanese data begins, so they can be compared.
              </p>
            )}
            <IndexTable rows={[en, ja]} />
          </>
        )}

        <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
          Each day the index moves by the typical change in price across
          everything priced on both that day and the day before (a geometric
          average; single-day moves beyond 2× are treated as bad data). Products
          and sets join the index as they appear, so it reflects the whole
          range, including new releases after launch hype fades.
          {params.metric.startsWith("set_")
            ? " For sets, only days with an unchanged count of priced cards count, so a card gaining a price can't pass for a price move."
            : ""}
        </p>
      </Card>

      {/* ---------------------------------------------------------- */}
      <Card className="p-4">
        <h2 className="font-medium">How prices age after release</h2>
        <p className="text-xs text-zinc-500 mt-0.5 max-w-prose">
          The typical change in a sealed product&apos;s price since{" "}
          {params.base === 0
            ? "its set came out"
            : `day ${params.base} after its set came out`}
          , for sets released since the history began.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <Chips label="Product">
            {SEALED_TYPES.map((k) => (
              <Chip
                key={k}
                href={insightHref(params, { kind: k })}
                on={params.kind === k}
              >
                {SEALED_TYPE_LABELS[k]}
              </Chip>
            ))}
          </Chips>
          <Chips label="Measured from">
            {BASE_AGES.map((b) => (
              <Chip
                key={b}
                href={insightHref(params, { base: b })}
                on={params.base === b}
              >
                {BASE_LABELS[b]}
              </Chip>
            ))}
          </Chips>
        </div>

        {ageLines.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500 max-w-prose">
            Too few sets have {SEALED_TYPE_LABELS[params.kind].toLowerCase()}{" "}
            priced at both ends of this window to draw a curve (at least 5 are
            needed).
          </p>
        ) : (
          <>
            <div className="mt-4">
              <div className="hidden sm:block">
                <AgeCurveChart lines={ageLines} size="wide" />
              </div>
              <div className="sm:hidden">
                <AgeCurveChart lines={ageLines} size="narrow" />
              </div>
            </div>
            <Legend
              items={ageLines.map((l) => ({
                label: l.label,
                stroke: l.stroke,
              }))}
              note="Line is the median set; the shaded band is the middle half of sets."
            />
            <AgeTable
              baseAge={params.base}
              rows={[
                { label: "English", curve: curves.en },
                { label: "Japanese", curve: curves.ja },
              ]}
            />
          </>
        )}

        <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
          Based on {setsBehind("en")} English and {setsBehind("ja")} Japanese
          sets that have this product. A set counts once per product kind, at
          the median if it has more than one. Only points with at least 5 sets
          are shown, so the longer ages (which only the oldest of these sets
          have reached) drop out first. The sets behind each point change as the
          age grows, so a small step between neighbouring points can be the mix
          of sets changing rather than prices.
          {params.base === 0
            ? " Release-day prices can include pre-order pricing; measuring from day 7 or day 30 shows the path after the launch rush."
            : ""}
        </p>
      </Card>

      <CardAges params={params} sets={cardSets} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function IndexTable({ rows }: { rows: Array<IndexSeries | undefined> }) {
  const present = rows.filter((r): r is IndexSeries => r != null);
  if (present.length === 0) return null;
  const windows = [
    { label: "1 month", short: "1M", days: 30 },
    { label: "3 months", short: "3M", days: 90 },
    { label: "1 year", short: "1Y", days: 365 },
  ];
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-xs sm:text-sm">
        <thead className="border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="py-2 pr-2 sm:pr-3 text-left font-medium"></th>
            {windows.map((w) => (
              <th
                key={w.days}
                className="px-1.5 sm:px-3 py-2 text-right font-medium"
              >
                <span className="sm:hidden">{w.short}</span>
                <span className="hidden sm:inline">{w.label}</span>
              </th>
            ))}
            <th className="px-1.5 sm:px-3 py-2 text-right font-medium">
              <span className="sm:hidden">Total</span>
              <span className="hidden sm:inline">Since start</span>
            </th>
            <th
              className="py-2 pl-1.5 sm:pl-3 text-right font-medium"
              title="The biggest fall from a previous high"
            >
              <span className="sm:hidden">Drop</span>
              <span className="hidden sm:inline">Worst drop</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {present.map((s) => {
            const first = s.points[0];
            const last = s.points[s.points.length - 1];
            const since = last.value / first.value - 1;
            return (
              <tr key={s.language}>
                <td className="py-2 pr-2 sm:pr-3 font-medium whitespace-nowrap">
                  {s.language === "en" ? "English" : "Japanese"}
                  <div className="text-[11px] font-normal text-zinc-500">
                    <span className="hidden sm:inline">from </span>
                    {monthYear(first.day)}
                  </div>
                </td>
                {windows.map((w) => {
                  const c = indexChange(s.points, w.days);
                  return (
                    <td
                      key={w.days}
                      className={`px-1.5 sm:px-3 py-2 text-right tabular-nums ${tone(c)}`}
                    >
                      {changeLabel(c)}
                    </td>
                  );
                })}
                <td
                  className={`px-1.5 sm:px-3 py-2 text-right tabular-nums ${tone(since)}`}
                >
                  {changeLabel(since)}
                </td>
                <td className="py-2 pl-1.5 sm:pl-3 text-right tabular-nums text-rose-600 dark:text-rose-400">
                  {changeLabel(-maxDrawdown(s.points))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
