// The only way a person's goals reach storage (ADR-0035). Pure.
//
// It cleans and clamps what was typed, refuses what can't be true (a target
// that is already behind the person's own starting point), and labels a target
// "stretch" when it is far beyond a rough rule of thumb. It never refuses a
// stretch and never invents a number.
import type { AutopilotGoal } from "@/lib/autopilot/contracts";
import {
  FOCUS_LABELS,
  GOALS_VERSION,
  GoalsSchema,
  METRIC_LABELS,
  TIMEFRAMES,
  type GoalFocus,
  type GoalMetric,
  type GoalTarget,
  type WorkspaceGoals,
} from "./contracts";

export type GoalWarning = { code: "stretch"; metric: GoalMetric; message: string };

export type GoalDecision =
  { ok: true; goals: WorkspaceGoals; warnings: GoalWarning[] } | { ok: false; error: string };

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export const platformLabel = (id: string | undefined) => (id ? (PLATFORM_LABELS[id] ?? id) : "");

/**
 * Rule of thumb for a small brand posting regularly: compound growth per week
 * from a known starting point, and a plain weekly amount when there is none.
 * Above these a target is labelled "stretch" (still saved).
 */
const STRETCH_WEEKLY_RATE: Record<GoalMetric, number> = {
  followers: 0.06,
  subscribers: 0.06,
  reach: 0.15,
  leads: 0.1,
  sales: 0.08,
  engagement: 0.12,
};
const STRETCH_WEEKLY_AMOUNT: Record<GoalMetric, number> = {
  followers: 500,
  subscribers: 300,
  reach: 25_000,
  leads: 40,
  sales: 40,
  engagement: 600,
};

export function isStretch(target: GoalTarget, weeks: number): boolean {
  const gain = target.target - (target.baseline ?? 0);
  if (target.baseline && target.baseline > 0) {
    const reachable = target.baseline * Math.pow(1 + STRETCH_WEEKLY_RATE[target.metric], weeks);
    return target.target > reachable && gain > STRETCH_WEEKLY_AMOUNT[target.metric] * weeks;
  }
  return gain > STRETCH_WEEKLY_AMOUNT[target.metric] * weeks;
}

const int = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(/[,\s_]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : undefined;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function nearestTimeframe(weeks: unknown): WorkspaceGoals["timeframeWeeks"] {
  const n = int(weeks) ?? 12;
  return TIMEFRAMES.reduce(
    (best, t) => (Math.abs(t - n) < Math.abs(best - n) ? t : best),
    12 as number,
  ) as WorkspaceGoals["timeframeWeeks"];
}

/** Clean, check and label a person's goals. `now` is when they are being set. */
export function decideGoals(
  raw: unknown,
  now: Date,
  previous?: WorkspaceGoals | null,
): GoalDecision {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const targetsIn = Array.isArray(o.targets) ? o.targets : [];
  const seen = new Set<string>();
  const targets: unknown[] = [];
  for (const t of targetsIn.slice(0, 6)) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const target = int(r.target);
    if (!target || target < 1) continue;
    const key = `${r.metric}:${r.platform ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const baseline = int(r.baseline);
    targets.push({
      metric: r.metric,
      ...(r.platform ? { platform: r.platform } : {}),
      target,
      ...(baseline !== undefined && baseline >= 0 ? { baseline } : {}),
    });
  }
  const channels = [...new Set(Array.isArray(o.channels) ? o.channels : [])];
  const timeframeWeeks = nearestTimeframe(o.timeframeWeeks);
  // A goal keeps its start date while the person only tweaks it; a new focus starts the clock.
  const startedAt =
    previous && previous.focus === o.focus && previous.timeframeWeeks === timeframeWeeks
      ? previous.startedAt
      : now.toISOString();

  const parsed = GoalsSchema.safeParse({
    v: GOALS_VERSION,
    focus: o.focus,
    targets: targets.slice(0, 3),
    timeframeWeeks,
    postsPerWeek: clamp(int(o.postsPerWeek) ?? 3, 1, 14),
    channels: channels.slice(0, 5),
    startedAt,
    note: typeof o.note === "string" ? o.note.slice(0, 240) : "",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") ?? "goals";
    if (field.startsWith("focus")) return { ok: false, error: "Choose what matters most first." };
    if (field.startsWith("channels"))
      return { ok: false, error: "One of those channels isn't supported." };
    return { ok: false, error: "Those numbers don't look right. Check them and try again." };
  }
  const goals = parsed.data;
  for (const t of goals.targets) {
    if (t.baseline !== undefined && t.target <= t.baseline) {
      return {
        ok: false,
        error: `Your ${METRIC_LABELS[t.metric]} target is at or below where you are today. Set a higher number.`,
      };
    }
  }
  const warnings: GoalWarning[] = goals.targets
    .filter((t) => isStretch(t, goals.timeframeWeeks))
    .map((t) => ({
      code: "stretch" as const,
      metric: t.metric,
      message: `${formatCount(t.target)} ${METRIC_LABELS[t.metric]} in ${goals.timeframeWeeks} weeks is a stretch. Mellox will plan for it, but no one can promise it.`,
    }));
  return { ok: true, goals, warnings };
}

export function toAutopilotGoal(focus: GoalFocus): AutopilotGoal {
  switch (focus) {
    case "followers":
    case "reach":
      return "awareness";
    case "leads":
      return "leads";
    case "sales":
      return "sales";
    case "engagement":
      return "engagement";
    case "launch":
      return "launch";
  }
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function goalDeadline(goals: Pick<WorkspaceGoals, "startedAt" | "timeframeWeeks">): Date {
  return new Date(Date.parse(goals.startedAt) + goals.timeframeWeeks * 7 * 86_400_000);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** One target in plain words: "+2,000 Instagram followers". */
export function targetLine(t: GoalTarget): string {
  const where = t.platform ? `${platformLabel(t.platform)} ` : "";
  const what = `${where}${METRIC_LABELS[t.metric]}`;
  if (t.baseline !== undefined && t.baseline > 0)
    return `${formatCount(t.baseline)} → ${formatCount(t.target)} ${what}`;
  return `${formatCount(t.target)} ${what}`;
}

/** The whole goal in one line: "Grow my following: 1,200 → 3,000 Instagram followers by 26 Jan". */
export function goalLine(goals: WorkspaceGoals): string {
  const label = FOCUS_LABELS[goals.focus].label;
  const by = shortDate(goalDeadline(goals));
  const first = goals.targets[0];
  return first ? `${label}: ${targetLine(first)} by ${by}` : `${label} by ${by}`;
}

/** The first target with its deadline ("1,200 → 3,000 Instagram followers by 24 Jan"), or "". */
export function goalTargetText(goals: WorkspaceGoals): string {
  const first = goals.targets[0];
  return first ? `${targetLine(first)} by ${shortDate(goalDeadline(goals))}` : "";
}
