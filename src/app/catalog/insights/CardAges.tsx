import { Card } from "@/components/ui";
import { AgeCurveChart, type AgeLine } from "./AgeCurveChart";
import { AgeTable, Chip, Chips, EN_LINE, JA_LINE, Legend } from "./parts";
import {
  CARD_BASE_AGES,
  CARD_METRIC_LABELS,
  CARD_METRICS,
  MIN_COVERAGE,
  setCurve,
  type AgedSet,
} from "@/lib/calc/card_curve";
import { insightHref, type InsightParams } from "@/lib/calc/insight_params";

const BASE_LABELS: Record<number, string> = {
  0: "Release day",
  7: "Day 7",
  14: "Day 14",
  30: "Day 30",
};

/**
 * How card values change after a set comes out: the chase (top 20), the top
 * 10, or the whole set. A set only counts for an age when its number of
 * priced cards is about what it was at the starting age, so a card getting its
 * first price can't pass for the market rising.
 */
export function CardAges({
  params,
  sets,
}: {
  params: InsightParams;
  sets: AgedSet[];
}) {
  const en = setCurve(sets, {
    metric: params.card,
    baseAge: params.cbase,
    language: "en",
  });
  const ja = setCurve(sets, {
    metric: params.card,
    baseAge: params.cbase,
    language: "ja",
  });
  const lines: AgeLine[] = [];
  if (en.length > 1) lines.push({ label: "English", points: en, ...EN_LINE });
  if (ja.length > 1) lines.push({ label: "Japanese", points: ja, ...JA_LINE });
  const count = (language: "en" | "ja") =>
    sets.filter((s) => s.language === language).length;

  return (
    <Card className="p-4">
      <h2 className="font-medium">How chase cards age after release</h2>
      <p className="text-xs text-zinc-500 mt-0.5 max-w-prose">
        The typical change in{" "}
        {params.card === "total"
          ? "a set's total value (one of each card)"
          : `the value of a set's ${params.card === "top20" ? "twenty" : "ten"} most valuable cards`}{" "}
        since {params.cbase === 0 ? "release day" : `day ${params.cbase}`}, for
        sets released since the history began.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <Chips label="Value">
          {CARD_METRICS.map((m) => (
            <Chip
              key={m}
              href={insightHref(params, { card: m })}
              on={params.card === m}
            >
              {CARD_METRIC_LABELS[m]}
            </Chip>
          ))}
        </Chips>
        <Chips label="Measured from">
          {CARD_BASE_AGES.map((b) => (
            <Chip
              key={b}
              href={insightHref(params, { cbase: b })}
              on={params.cbase === b}
            >
              {BASE_LABELS[b]}
            </Chip>
          ))}
        </Chips>
      </div>

      {lines.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 max-w-prose">
          Too few sets have a comparable card count from this starting age to
          draw a curve (at least 5 are needed). Try a later starting age.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <div className="hidden sm:block">
              <AgeCurveChart lines={lines} size="wide" />
            </div>
            <div className="sm:hidden">
              <AgeCurveChart lines={lines} size="narrow" />
            </div>
          </div>
          <Legend
            items={lines.map((l) => ({ label: l.label, stroke: l.stroke }))}
            note="Line is the median set; the shaded band is the middle half of sets."
          />
          <AgeTable
            baseAge={params.cbase}
            rows={[
              { label: "English", curve: en },
              { label: "Japanese", curve: ja },
            ]}
          />
        </>
      )}

      <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed max-w-prose">
        {`Based on ${count("en")} English and ${count("ja")} Japanese sets with at least 40 priced cards. A set counts for an age only when its priced-card count is within ${Math.round((1 - MIN_COVERAGE) * 100)}% of what it was at the starting age, because a set's value also grows when cards gain a price. `}
        {ja.length === 0 && params.cbase < 14
          ? "Japanese sets are mostly unpriced for their first two weeks, so there is no Japanese curve from this starting age. "
          : ""}
        {"Only points with at least 5 sets are shown, and the sets behind each point change as the age grows."}
      </p>
    </Card>
  );
}
