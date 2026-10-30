// Where a campaign stands, from rows that exist. A piece's state is read from
// its Autopilot step; views are what the post itself recorded. The goal's
// number (registrations, sales) is the one the person typed in: Mellox can't
// see their form, so it never estimates it.
// Pure: no I/O.
import type { ActionStatus } from "@/lib/autopilot/contracts";
import type { CampaignProgress, PieceState, PieceView } from "./contracts";

const STATE: Record<ActionStatus, PieceState> = {
  proposed: "planned",
  planned: "planned",
  generating: "making",
  needs_approval: "waiting",
  approved: "scheduled",
  scheduled: "scheduled",
  published: "out",
  measured: "out",
  done: "out",
  skipped: "missed",
  missed: "missed",
  rejected: "cancelled",
  failed: "failed",
  cancelled: "cancelled",
};

export function pieceState(status: ActionStatus | null | undefined): PieceState {
  return status ? (STATE[status] ?? "planned") : "idea";
}

export const STATE_LABELS: Record<PieceState, string> = {
  idea: "Idea",
  planned: "Planned",
  making: "Being made",
  waiting: "Waiting for you",
  scheduled: "Scheduled",
  out: "Posted",
  missed: "Missed",
  failed: "Didn't work",
  cancelled: "Removed",
};

/** Steps that haven't made anything yet, so a plan change may replace them. */
export const UNMADE: readonly ActionStatus[] = ["proposed", "planned"];

export function campaignProgress(pieces: readonly PieceView[]): CampaignProgress {
  const live = pieces.filter((p) => p.state !== "cancelled");
  const out = live.filter((p) => p.state === "out");
  const measured = out.filter((p) => p.views !== null);
  return {
    pieces: live.length,
    out: out.length,
    waiting: live.filter((p) => p.state === "waiting").length,
    measured: measured.length,
    views: measured.length ? measured.reduce((sum, p) => sum + (p.views ?? 0), 0) : null,
  };
}

/** The phase that's on today: the one whose days include it, else the next. */
export function currentPhase<T extends { id: string; startsOn: string; endsOn: string }>(
  phases: readonly T[],
  today: string,
): T | null {
  return (
    phases.find((p) => p.startsOn <= today && today <= p.endsOn) ??
    phases.find((p) => p.startsOn > today) ??
    null
  );
}

/** How far through the campaign's days today is, 0 to 1. */
export function timeProgress(startsOn: string, endsOn: string, today: string): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T23:59:59Z`);
  const now = Date.parse(`${today}T12:00:00Z`);
  if (!(end > start)) return 0;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

/** "in 5 days", "today", "3 days ago". */
export function daysUntil(date: string, today: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}
