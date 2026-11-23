"use client";

import {
  EXIT_REASONS,
  EXIT_REASON_HINTS,
  EXIT_REASON_LABELS,
  type ExitReason,
} from "@/lib/calc/exit_reason";

/**
 * "Why is it leaving?" selector for a sell. Plain segmented buttons so the
 * common case (Sold) stays one tap and the others are visible, not buried.
 */
export function ExitReasonPicker({
  value,
  onChange,
}: {
  value: ExitReason;
  onChange: (next: ExitReason) => void;
}) {
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Why is it leaving?"
        className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      >
        {EXIT_REASONS.map((r) => {
          const active = r === value;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(r)}
              className={`h-9 rounded-md border text-sm font-medium transition-colors ${
                active
                  ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                  : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              {EXIT_REASON_LABELS[r]}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-500 mt-1.5">
        {EXIT_REASON_HINTS[value]}
      </p>
    </div>
  );
}
