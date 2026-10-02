// How Autopilot's state reads to a person, per workspace and across an
// agency's clients. Pure: the Command Center and the workspace surface share it.
import type { AgencyAutopilotRow } from "./contracts";

export type AutopilotTone = "good" | "warn" | "risk" | "idle";

export const PAUSE_REASONS: Record<string, string> = {
  user: "Paused by your team",
  member_left: "The person who started it left this workspace",
  agents_paused: "Automation is switched off for this workspace",
  plan: "Your plan doesn't include Autopilot",
};

export function pauseReasonText(reason: string | null): string {
  return (reason && PAUSE_REASONS[reason]) || "Paused";
}

/** How many things in this workspace are waiting on a person. */
export function needsYou(row: AgencyAutopilotRow): number {
  return row.needsApproval + (row.planWaiting > 0 ? 1 : 0) + row.failures;
}

export function rowState(row: AgencyAutopilotRow): { label: string; tone: AutopilotTone } {
  if (!row.programId || !row.status) return { label: "Off", tone: "idle" };
  if (row.status === "paused") {
    return {
      label: "Paused",
      tone: row.pauseReason && row.pauseReason !== "user" ? "risk" : "warn",
    };
  }
  if (row.failures > 0) return { label: "Running", tone: "risk" };
  if (needsYou(row) > 0 || row.missed > 0) return { label: "Running", tone: "warn" };
  return { label: "Running", tone: "good" };
}

/** Most urgent first: failures, then things to approve, then opportunities. */
export function sortAgencyRows<T extends AgencyAutopilotRow>(rows: T[]): T[] {
  const weight = (r: AgencyAutopilotRow) =>
    r.failures * 1000 +
    (r.status === "paused" && r.pauseReason !== "user" ? 500 : 0) +
    needsYou(r) * 10 +
    r.newOpportunities +
    (r.programId ? 0.5 : 0);
  return [...rows].sort((a, b) => weight(b) - weight(a));
}

export type AutopilotAttention = {
  id: string;
  tone: "risk" | "warn" | "info";
  title: string;
  detail: string;
  cta: string;
  workspaceId?: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The few lines Agency HQ shows first. `nameOf` resolves a client's name. */
export function buildAutopilotAttention(
  rows: AgencyAutopilotRow[],
  nameOf: (workspaceId: string) => string,
): AutopilotAttention[] {
  const out: AutopilotAttention[] = [];

  const failing = rows.filter((r) => r.failures > 0);
  if (failing.length) {
    const total = failing.reduce((n, r) => n + r.failures, 0);
    out.push({
      id: "autopilot-failures",
      tone: "risk",
      title: `${plural(total, "Autopilot step")} didn't work`,
      detail:
        failing.length === 1
          ? `For ${nameOf(failing[0].workspaceId)}. Retry or fix it.`
          : `Across ${plural(failing.length, "client")}. Retry or fix them.`,
      cta: "Fix",
      workspaceId: failing.length === 1 ? failing[0].workspaceId : undefined,
    });
  }

  for (const row of rows) {
    if (row.status === "paused" && row.pauseReason && row.pauseReason !== "user") {
      out.push({
        id: `autopilot-paused-${row.workspaceId}`,
        tone: "risk",
        title: `Autopilot paused for ${nameOf(row.workspaceId)}`,
        detail: `${pauseReasonText(row.pauseReason)}.`,
        cta: "Open",
        workspaceId: row.workspaceId,
      });
    }
  }

  const waiting = rows.filter((r) => r.needsApproval > 0 || r.planWaiting > 0);
  if (waiting.length) {
    const pieces = waiting.reduce((n, r) => n + r.needsApproval, 0);
    out.push({
      id: "autopilot-approvals",
      tone: "warn",
      title:
        waiting.length === 1
          ? `${nameOf(waiting[0].workspaceId)} is waiting on you`
          : `${plural(waiting.length, "client")} are waiting on you`,
      detail: pieces ? `${plural(pieces, "piece")} to approve.` : "A plan to approve.",
      cta: "Review",
      workspaceId: waiting.length === 1 ? waiting[0].workspaceId : undefined,
    });
  }

  const warned = rows.filter((r) => r.performanceWarnings > 0);
  if (warned.length) {
    out.push({
      id: "autopilot-performance",
      tone: "warn",
      title:
        warned.length === 1
          ? `Posts are slowing down for ${nameOf(warned[0].workspaceId)}`
          : `Posts are slowing down for ${plural(warned.length, "client")}`,
      detail: "Recent posts reached fewer people than usual.",
      cta: "Look",
      workspaceId: warned.length === 1 ? warned[0].workspaceId : undefined,
    });
  }

  const fresh = rows.reduce((n, r) => n + r.newOpportunities, 0);
  if (fresh > 0) {
    out.push({
      id: "autopilot-opportunities",
      tone: "info",
      title: `${plural(fresh, "new opportunity", "new opportunities")}`,
      detail: "Things worth responding to this week.",
      cta: "See",
    });
  }
  return out;
}
