// The action state machine. Every status change the worker or a person makes
// goes through `canTransition`, and is written as a compare-and-set on the
// status it was read at, so two writers can never both win.
import type { ActionKind, ActionStatus } from "./contracts";

const CONTENT: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ["planned", "cancelled"],
  planned: ["generating", "skipped", "failed", "cancelled"],
  generating: ["needs_approval", "skipped", "failed", "cancelled"],
  needs_approval: ["approved", "rejected", "missed", "cancelled"],
  // Edited after approval: the content trigger sends the item back to draft,
  // so the action goes back to waiting.
  approved: ["scheduled", "done", "needs_approval", "missed", "failed", "cancelled"],
  scheduled: ["published", "failed", "cancelled"],
  published: ["measured"],
  measured: [],
  done: [],
  skipped: [],
  missed: [],
  rejected: [],
  // Retry: make it again, or (when the piece exists) try scheduling again.
  failed: ["planned", "approved", "cancelled"],
  cancelled: [],
};

const JOB: Partial<Record<ActionStatus, readonly ActionStatus[]>> = {
  planned: ["done", "skipped", "failed", "cancelled"],
  failed: ["planned", "cancelled"],
};

export function canTransition(kind: ActionKind, from: ActionStatus, to: ActionStatus): boolean {
  const table = kind === "content" ? CONTENT : JOB;
  return (table[from] ?? []).includes(to);
}

/** Statuses the worker still has something to do for. Mirrors the claim RPC. */
export const WORKER_STATUSES: readonly ActionStatus[] = [
  "planned",
  "generating",
  "needs_approval",
  "approved",
  "scheduled",
  "published",
];

export const TERMINAL_STATUSES: readonly ActionStatus[] = [
  "measured",
  "done",
  "skipped",
  "missed",
  "rejected",
  "failed",
  "cancelled",
];

export function isTerminal(status: ActionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Statuses that can still be cancelled when a program is stopped. */
export const CANCELLABLE_STATUSES: readonly ActionStatus[] = [
  "proposed",
  "planned",
  "generating",
  "needs_approval",
  "approved",
];

export const STATUS_LABEL: Record<ActionStatus, string> = {
  proposed: "In the plan",
  planned: "Planned",
  generating: "Being made",
  needs_approval: "Needs approval",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Posted",
  measured: "Posted",
  done: "Ready",
  skipped: "Skipped",
  missed: "Not approved in time",
  rejected: "Skipped by you",
  failed: "Didn't work",
  cancelled: "Cancelled",
};

export type StatusTone = "neutral" | "active" | "attention" | "good" | "bad";

export function statusTone(status: ActionStatus): StatusTone {
  switch (status) {
    case "generating":
    case "approved":
    case "scheduled":
      return "active";
    case "needs_approval":
    case "proposed":
    case "missed":
      return "attention";
    case "published":
    case "measured":
    case "done":
      return "good";
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}
