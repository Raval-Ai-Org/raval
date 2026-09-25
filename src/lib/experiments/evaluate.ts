// evaluate.ts — one analysis pass: the daily early read plus any checkpoint
// that has come due. Pure; the worker (src/server/experiments/analyze.server.ts)
// and the statistics tests run exactly this.
import { MAX_DURATION_DAYS } from "./constants";
import {
  analyzeExperiment,
  type AnalysisInput,
  type AnalysisOptions,
  type AnalysisResult,
} from "./analysis";
import { decideAtCheckpoint, dueCheckpoint, type Verdict } from "./verdict";

export type CheckpointOutcome = {
  day: number;
  verdict: Verdict | null;
  reason: string;
  result: AnalysisResult;
};

export type EvaluationResult = {
  /** Everything since the live date (capped at the maximum duration). */
  early: AnalysisResult;
  checkpoints: CheckpointOutcome[];
  /** The first checkpoint that reached a verdict, if any. */
  final: CheckpointOutcome | null;
  lastCheckpointDay: number | null;
};

export function evaluateExperiment(
  input: AnalysisInput,
  lastCheckpointDay: number | null,
  opts: AnalysisOptions = {},
): EvaluationResult {
  const postDates = input.postDates.slice(0, MAX_DURATION_DAYS);
  const early = analyzeExperiment({ ...input, postDates }, opts);
  const checkpoints: CheckpointOutcome[] = [];
  let last = lastCheckpointDay;
  let final: CheckpointOutcome | null = null;
  for (;;) {
    const day = dueCheckpoint(postDates.length, last);
    if (day === null) break;
    const result =
      day === postDates.length
        ? early
        : analyzeExperiment({ ...input, postDates: postDates.slice(0, day) }, opts);
    const decision = decideAtCheckpoint(result, day);
    const outcome = { day, verdict: decision.verdict, reason: decision.reason, result };
    checkpoints.push(outcome);
    last = day;
    if (decision.verdict) {
      final = outcome;
      break;
    }
  }
  return { early, checkpoints, final, lastCheckpointDay: last };
}
