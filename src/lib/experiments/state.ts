// state.ts — the Proof Engine experiment lifecycle (ADR-0024 §3).
//
//   draft → awaiting_approval → shipping → awaiting_deploy → running ⇄ analyzing
//         → concluded (win | loss | inconclusive) → rolling_out | rolling_back → closed
//   plus invalidated and cancelled.
//
// The one place allowed transitions are defined. The database CHECKs the
// values; server code writes status compare-and-set on the expected current
// status after asking `canTransition`. Pure: safe in the browser.

export const EXPERIMENT_STATUSES = [
  "draft",
  "awaiting_approval",
  "shipping",
  "awaiting_deploy",
  "running",
  "analyzing",
  "concluded",
  "rolling_out",
  "rolling_back",
  "closed",
  "invalidated",
  "cancelled",
] as const;

export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const VERDICTS = ["win", "loss", "inconclusive"] as const;
export type Verdict = (typeof VERDICTS)[number];

const TRANSITIONS: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  // Designing: pages, split and change are still editable.
  draft: ["awaiting_approval", "cancelled"],
  // Back to draft to edit; shipping once an editor approves the exact patch.
  awaiting_approval: ["draft", "shipping", "cancelled"],
  // Opening the pull request. A failure (base moved, access lost) needs a new approval.
  shipping: ["awaiting_deploy", "awaiting_approval", "cancelled"],
  // PR open or merged, waiting for the live check. A PR closed unmerged cancels;
  // lost ownership or access invalidates.
  awaiting_deploy: ["running", "cancelled", "invalidated"],
  running: ["analyzing", "invalidated", "cancelled"],
  // A daily analysis: back to running, or concluded at a checkpoint.
  analyzing: ["running", "concluded", "invalidated"],
  // The user chooses: roll out, roll back, or keep things as they are.
  concluded: ["rolling_out", "rolling_back", "closed"],
  // A rollout/rollback PR closed unmerged returns to concluded.
  rolling_out: ["closed", "concluded"],
  rolling_back: ["closed", "concluded"],
  // The change may still be live on treatment pages: roll it back, or close.
  invalidated: ["rolling_back", "closed"],
  closed: [],
  cancelled: [],
};

export function isExperimentStatus(value: unknown): value is ExperimentStatus {
  return typeof value === "string" && (EXPERIMENT_STATUSES as readonly string[]).includes(value);
}

export function allowedTransitions(from: ExperimentStatus): readonly ExperimentStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ExperimentStatus, to: ExperimentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ExperimentStatus,
    readonly to: ExperimentStatus,
  ) {
    super(`An experiment can't go from ${from} to ${to}.`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: ExperimentStatus, to: ExperimentStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** No further transitions. */
export function isTerminal(status: ExperimentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Counts against the plan's concurrent-experiment limit. */
export function countsTowardLimit(status: ExperimentStatus): boolean {
  return (
    status === "awaiting_approval" ||
    status === "shipping" ||
    status === "awaiting_deploy" ||
    status === "running" ||
    status === "analyzing" ||
    status === "concluded"
  );
}

/** Pages stay reserved (one active experiment per page) until closed or cancelled. */
export function holdsPages(status: ExperimentStatus): boolean {
  return status !== "closed" && status !== "cancelled";
}

/** Measuring: metrics are pulled and analysed daily. */
export function isMeasuring(status: ExperimentStatus): boolean {
  return status === "running" || status === "analyzing";
}

/** The design (metric, split, changes) can still be edited. */
export function isEditable(status: ExperimentStatus): boolean {
  return status === "draft";
}
