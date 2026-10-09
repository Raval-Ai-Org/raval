// What Autopilot does next, and when. Read from the same view the screens
// already have: nothing here is a promise the worker does not hold itself,
// every time is the step's own due time. Pure and browser-safe.
import type { ActionView, AutopilotView } from "./contracts";

export type NextStepKind = "write" | "post" | "plan" | "check" | "wait";

export type NextStep = {
  id: string;
  kind: NextStepKind;
  /** When it happens. In the past means "as soon as the worker gets to it". */
  at: string;
  /** "Writes", "Posts", "Plans next week"… the start of the sentence. */
  verb: string;
  /** What it is about; empty for a step with no piece. */
  title: string;
  /** The piece this step belongs to, when it has one. */
  action: ActionView | null;
  /** True when it only moves once a person says yes. */
  needsYou: boolean;
};

type Source = Pick<AutopilotView, "program" | "proposed" | "approvals" | "upcoming" | "tasks"> & {
  nextPlanAt?: string | null;
};

const TASK_VERB: Record<string, string> = {
  geo_scan: "Checks your AI visibility",
  repurpose: "Picks a post to reuse",
  weekly_report: "Sends your weekly summary",
};

function stepFor(action: ActionView): NextStep | null {
  const base = { id: action.id, title: action.title, action };
  switch (action.status) {
    case "planned":
      return action.nextStepAt
        ? { ...base, kind: "write", at: action.nextStepAt, verb: "Writes", needsYou: false }
        : null;
    case "generating":
      return {
        ...base,
        kind: "write",
        at: action.updatedAt,
        verb: "Writing now",
        needsYou: false,
      };
    case "approved":
    case "scheduled":
      return action.plannedFor
        ? { ...base, kind: "post", at: action.plannedFor, verb: "Posts", needsYou: false }
        : null;
    case "needs_approval":
    case "proposed":
      return action.plannedFor
        ? {
            ...base,
            kind: "wait",
            at: action.plannedFor,
            verb: action.status === "proposed" ? "Waits for your OK on the plan" : "Waits for you",
            needsYou: true,
          }
        : null;
    default:
      return null;
  }
}

/**
 * The next things Autopilot does, soonest first. Steps that only wait for a
 * person are left out unless `withWaiting`: the screens already show those
 * with a button.
 */
export function nextSteps(
  view: Source,
  opts: { limit?: number; withWaiting?: boolean } = {},
): NextStep[] {
  if (!view.program || view.program.status !== "running") return [];
  const steps: NextStep[] = [];
  for (const action of [...view.upcoming, ...view.approvals, ...view.proposed]) {
    if (action.kind !== "content") continue;
    const step = stepFor(action);
    if (step && (opts.withWaiting || !step.needsYou)) steps.push(step);
  }
  for (const task of view.tasks) {
    if (task.status !== "planned" || !task.nextStepAt) continue;
    steps.push({
      id: task.id,
      kind: "check",
      at: task.nextStepAt,
      verb: TASK_VERB[task.contentType ?? ""] ?? task.title,
      title: "",
      action: null,
      needsYou: false,
    });
  }
  if (view.nextPlanAt) {
    steps.push({
      id: "plan",
      kind: "plan",
      at: view.nextPlanAt,
      verb: "Plans your next week",
      title: "",
      action: null,
      needsYou: false,
    });
  }
  return steps.sort((a, b) => a.at.localeCompare(b.at)).slice(0, opts.limit ?? 6);
}

/** "Now", "Today 14:00", "Tomorrow 09:00", "Thu 09:00" in the viewer's own time. */
export function stepWhen(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  // A step that is due is picked up within a minute or two.
  if (date.getTime() <= now.getTime() + 60_000) return "Now";
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(date) - day(now)) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days < 7) return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

/** One line: "Writes “Five ways…” · Today 14:00". */
export function stepLine(step: NextStep, now: Date = new Date()): string {
  const what = step.title ? `${step.verb} “${step.title}”` : step.verb;
  const when = stepWhen(step.at, now);
  return step.kind === "write" && step.verb === "Writing now" ? what : `${what} · ${when}`;
}
