/**
 * Constants and pure helpers for insight signals.
 *
 * Lives outside `src/lib/server/` because `"use server"` modules only
 * permit async-function exports — these need to be importable from
 * client components too.
 */

import type { MentionSentiment } from "@/db/schema";

export type SignalLabel =
  | "strong_buy"
  | "watch_bull"
  | "watch_bear"
  | "strong_sell";

export const SENTIMENT_OPTIONS: ReadonlyArray<MentionSentiment> = [
  "bullish",
  "bearish",
  "neutral",
  "mixed",
] as const;

/** Time-window presets the filter bar offers. `0` means "all time". */
export const TIME_WINDOW_OPTIONS: ReadonlyArray<{
  days: number;
  label: string;
}> = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 0, label: "All time" },
];

export const DEFAULT_TIME_WINDOW_DAYS = 30;

export function describeLabel(
  label: SignalLabel,
): { text: string; tone: "bull" | "bear" } {
  switch (label) {
    case "strong_buy":
      return { text: "Strong buy", tone: "bull" };
    case "watch_bull":
      return { text: "Watch (bullish)", tone: "bull" };
    case "watch_bear":
      return { text: "Watch (bearish)", tone: "bear" };
    case "strong_sell":
      return { text: "Strong sell", tone: "bear" };
  }
}
