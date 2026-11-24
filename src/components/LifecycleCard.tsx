import { Card } from "@/components/ui";
import {
  ageLabel,
  PHASE_LABELS,
  spanLabel,
  THIN_SETS,
  type Lifecycle,
  type Position,
} from "@/lib/calc/lifecycle";
import { SEALED_TYPE_LABELS } from "@/lib/calc/sealed_type";
import { changeLabel } from "@/lib/calc/set_list";

export const POSITION_TEXT: Record<Position, string> = {
  below: "Below the typical range",
  within: "In the typical range",
  above: "Above the typical range",
};

export const POSITION_TONE: Record<Position, string> = {
  below: "text-rose-600 dark:text-rose-400",
  within: "text-zinc-600 dark:text-zinc-300",
  above: "text-emerald-600 dark:text-emerald-400",
};

const tone = (c: number) =>
  c > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : c < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-zinc-500";

const baseName = (baseAge: number) =>
  baseAge === 0 ? "release day" : `day ${baseAge}`;

/**
 * Where one linked sealed product is in its life: its age, how it has moved
 * since an early price against what the same kind of product typically did
 * by now, and what earlier sets did next. All of it is how earlier sets
 * behaved, not a forecast.
 */
export function LifecycleCard({
  lifecycle,
  releasedOn,
}: {
  lifecycle: Lifecycle;
  releasedOn: string | null;
}) {
  const { ageDays, phase, own, typical, position, forward, kind } = lifecycle;
  if (ageDays == null || phase == null) return null;

  const kindLabel = kind ? SEALED_TYPE_LABELS[kind].toLowerCase() : null;
  const released = releasedOn
    ? new Date(`${releasedOn}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <Card className="p-4">
      <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        Where it is in its life
      </h2>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold">{ageLabel(ageDays)}</span>
        <span className="text-sm text-zinc-500">
          {PHASE_LABELS[phase]}
          {released
            ? ` · ${ageDays < 0 ? "releases" : "released"} ${released}`
            : ""}
        </span>
      </div>

      {own && (
        <div className="mt-3 text-sm">
          <div>
            Since {baseName(own.baseAge)}:{" "}
            <span className={`font-medium tabular-nums ${tone(own.change)}`}>
              {changeLabel(own.change)}
            </span>
            {typical && position && (
              <>
                {" "}
                <span className="text-zinc-500">·</span>{" "}
                <span className={`font-medium ${POSITION_TONE[position]}`}>
                  {POSITION_TEXT[position]}
                </span>
                {typical.sets < THIN_SETS && (
                  <span className="text-xs text-zinc-500"> (few sets)</span>
                )}
              </>
            )}
          </div>
          {typical ? (
            <p className="mt-0.5 text-xs text-zinc-500 leading-relaxed max-w-prose">
              {`Earlier sets' ${kindLabel} were typically ${changeLabel(typical.median)} by this age (the middle half between ${changeLabel(typical.p25)} and ${changeLabel(typical.p75)}), across ${typical.sets} sets.`}
            </p>
          ) : kind ? (
            <p className="mt-0.5 text-xs text-zinc-500 leading-relaxed max-w-prose">
              Too few earlier sets are this old to compare against.
            </p>
          ) : null}
        </div>
      )}

      {forward.length > 0 && kindLabel && (
        <div className="mt-3">
          <div className="text-xs text-zinc-500">
            From about this age, earlier sets&apos; {kindLabel}:
          </div>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {forward.map((f) => (
              <li key={f.toAge}>
                <span className="inline-block first-letter:uppercase">
                  {spanLabel(f.toAge - f.fromAge)}
                </span>
                :{" "}
                <span className={`font-medium tabular-nums ${tone(f.median)}`}>
                  {changeLabel(f.median)}
                </span>{" "}
                <span className="text-xs text-zinc-500">
                  {`median · ${Math.round(f.shareUp * 100)}% rose · middle half ${changeLabel(f.p25)} to ${changeLabel(f.p75)} · ${f.sets} sets`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!kind && (
        <p className="mt-3 text-xs text-zinc-500 max-w-prose leading-relaxed">
          There&apos;s no comparison for this kind of product: tins,
          collections, blisters and exclusives don&apos;t follow the same path
          as boxes, trainer boxes, bundles and packs.
        </p>
      )}
      {kind && own == null && forward.length === 0 && (
        <p className="mt-3 text-xs text-zinc-500 max-w-prose leading-relaxed">
          No early price is on record for this product, and too few earlier sets
          are this old, so there&apos;s nothing to compare yet.
        </p>
      )}
      <p className="mt-3 text-[11px] text-zinc-500">
        Past sets only, not a forecast.{" "}
        <a
          href={`/catalog/insights${kind ? `?kind=${kind}` : ""}`}
          className="underline hover:no-underline"
        >
          See the full curves
        </a>
      </p>
    </Card>
  );
}
