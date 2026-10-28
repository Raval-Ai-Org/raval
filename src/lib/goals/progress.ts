// Progress toward a goal, from stored rows only (ADR-0035). Pure.
//
// Mellox can count the posts it published and the views those posts got. It
// cannot read follower, subscriber, lead or sales counts today, so those rows
// say so and point at the fix. No row ever shows an estimate.
import { METRIC_LABELS, type GoalMetric, type WorkspaceGoals } from "./contracts";
import { formatCount, goalDeadline, platformLabel } from "./decide";

export type MeasuredFacts = {
  /** Posts Mellox published since the goal started. */
  postsPublished: number;
  /** Views on those posts, when analytics reported any. Null when none were measured. */
  views: number | null;
  /** Platforms with a connected account. */
  connected: string[];
};

export type ProgressRow =
  | {
      id: string;
      state: "measured";
      label: string;
      value: number;
      target: number | null;
      /** 0..1, only when there is a target. */
      ratio: number | null;
      detail: string;
    }
  | { id: string; state: "not_measured"; label: string; reason: string; fix: string };

export type GoalProgress = {
  weeksElapsed: number;
  weeksLeft: number;
  /** The share of the timeframe that has passed, 0..1. */
  timeRatio: number;
  rows: ProgressRow[];
};

const UNMEASURABLE: Partial<Record<GoalMetric, string>> = {
  followers: "Mellox can't read follower counts from your accounts yet.",
  subscribers: "Mellox can't read subscriber counts from your accounts yet.",
  leads: "Mellox doesn't see your enquiries or sign-ups yet.",
  sales: "Mellox doesn't see your orders yet.",
};

export function goalProgress(
  goals: WorkspaceGoals,
  measured: MeasuredFacts,
  now: Date,
): GoalProgress {
  const start = Date.parse(goals.startedAt);
  const totalMs = goals.timeframeWeeks * 7 * 86_400_000;
  const elapsedMs = Math.min(totalMs, Math.max(0, now.getTime() - start));
  const weeksElapsed = Math.floor(elapsedMs / (7 * 86_400_000));
  const weeksLeft = Math.max(
    0,
    Math.ceil((goalDeadline(goals).getTime() - now.getTime()) / (7 * 86_400_000)),
  );
  const rows: ProgressRow[] = [];

  // Cadence is always measurable: the plan is the person's own number.
  const plannedSoFar = Math.max(1, Math.ceil((elapsedMs / (7 * 86_400_000)) * goals.postsPerWeek));
  rows.push({
    id: "posts",
    state: "measured",
    label: "Posts published",
    value: measured.postsPublished,
    target: goals.postsPerWeek * goals.timeframeWeeks,
    ratio: Math.min(1, measured.postsPublished / (goals.postsPerWeek * goals.timeframeWeeks)),
    detail:
      measured.postsPublished >= plannedSoFar
        ? "On pace with your plan"
        : `${formatCount(plannedSoFar - measured.postsPublished)} behind your plan so far`,
  });

  for (const t of goals.targets) {
    const label = `${t.platform ? `${platformLabel(t.platform)} ` : ""}${METRIC_LABELS[t.metric]}`;
    const id = `${t.metric}:${t.platform ?? "all"}`;
    if (t.metric === "reach" || t.metric === "engagement") {
      if (t.metric === "reach" && measured.views !== null) {
        rows.push({
          id,
          state: "measured",
          label: "Views on Mellox posts",
          value: measured.views,
          target: t.target,
          ratio: Math.min(1, measured.views / t.target),
          detail: "Counted on posts Mellox published since you set the goal",
        });
        continue;
      }
      rows.push({
        id,
        state: "not_measured",
        label,
        reason: "No post results have come in yet.",
        fix: measured.connected.length
          ? "Results appear a day or two after posts go out."
          : "Connect an account so Mellox can read post results.",
      });
      continue;
    }
    rows.push({
      id,
      state: "not_measured",
      label,
      reason: UNMEASURABLE[t.metric] ?? "Mellox can't measure this yet.",
      fix:
        t.baseline !== undefined
          ? `You started at ${formatCount(t.baseline)}. Update it in Brain when you check.`
          : "Add where you are today in Brain so you can see the gap.",
    });
  }

  return { weeksElapsed, weeksLeft, timeRatio: elapsedMs / totalMs, rows };
}
