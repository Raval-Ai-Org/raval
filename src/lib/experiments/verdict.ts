// verdict.ts — when a result becomes a verdict (ADR-0024 §6).
//
// The data is analysed daily, but a verdict is only evaluated at fixed
// checkpoints (CHECKPOINT_DAYS complete days after the live date), each at the
// Pocock-adjusted level CHECKPOINT_ALPHA, so four looks keep false verdicts
// near 5% overall. Before the first checkpoint there is only an "early read".
//
//   win           adjusted interval entirely above 0 and placebo p < α
//   loss          adjusted interval entirely below 0 and placebo p < α
//   inconclusive  the last checkpoint passes with neither
import { CHECKPOINT_ALPHA, CHECKPOINT_DAYS } from "./constants";
import type { AnalysisResult } from "./analysis";

export type Verdict = "win" | "loss" | "inconclusive";

export const FINAL_CHECKPOINT = CHECKPOINT_DAYS[CHECKPOINT_DAYS.length - 1];

/** The next checkpoint to evaluate, given complete post days and the last one evaluated. */
export function dueCheckpoint(postDays: number, lastCheckpointDay: number | null): number | null {
  for (const day of CHECKPOINT_DAYS) {
    if (day > (lastCheckpointDay ?? 0) && day <= postDays) return day;
  }
  return null;
}

export function nextCheckpoint(postDays: number): number | null {
  return CHECKPOINT_DAYS.find((d) => d > postDays) ?? null;
}

export type CheckpointDecision = { verdict: Verdict | null; reason: string };

/** `result` must be the analysis of exactly the first `day` post days. */
export function decideAtCheckpoint(result: AnalysisResult, day: number): CheckpointDecision {
  const final = day >= FINAL_CHECKPOINT;
  if (result.lift === null || !result.ciAdjusted || result.placeboP === null) {
    return final
      ? { verdict: "inconclusive", reason: result.reason ?? "The data couldn't support a result." }
      : { verdict: null, reason: result.reason ?? "Not enough data yet." };
  }
  const [lo, hi] = result.ciAdjusted;
  const significant = result.placeboP < CHECKPOINT_ALPHA;
  if (lo > 0 && significant) return { verdict: "win", reason: `Clear improvement at day ${day}.` };
  if (hi < 0 && significant) return { verdict: "loss", reason: `Clear decline at day ${day}.` };
  if (final) {
    return {
      verdict: "inconclusive",
      reason: `No clear difference after ${day} days.`,
    };
  }
  return { verdict: null, reason: `Not clear yet at day ${day}; next check at a later day.` };
}
