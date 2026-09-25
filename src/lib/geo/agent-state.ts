// agent-state.ts — the GEO coding agent's state machine and the timeline the
// UI shows. Pure: the runner and service call `nextStatus` before every
// status write (and write with compare-and-set on the previous status), so an
// illegal jump is refused instead of shown.

import type { ProposalStatus, VerificationStatus } from "./fix-contracts";
import type { AgentRunStatus, TimelineStep, TimelineStepId } from "./agent-contracts";
import { AGENT_TERMINAL_STATUSES } from "./agent-contracts";

export type AgentEvent =
  | "start"
  | "plan_submitted"
  | "input_needed"
  | "not_fixable"
  | "inputs_submitted"
  | "approve_plan"
  | "revise_plan"
  | "patch_submitted"
  | "review_passed"
  | "review_revise"
  | "validation_passed"
  | "validation_failed"
  | "correction_started"
  | "proposal_rejected"
  | "apply_started"
  | "pr_opened"
  | "base_moved"
  | "pr_merged"
  | "pr_closed"
  | "pr_reopened"
  | "verification_started"
  | "verified"
  | "not_verified"
  | "fail"
  | "cancel"
  /** CMS runs: exact field changes are ready (no plan step; the change itself is approved). */
  | "cms_changes_submitted"
  /** CMS runs: the approved change was written to the live site. */
  | "applied_live"
  /** CMS runs: the person undid an applied change. */
  | "rolled_back";

const T: Partial<Record<AgentRunStatus, Partial<Record<AgentEvent, AgentRunStatus>>>> = {
  queued: { start: "investigating", cancel: "cancelled", fail: "failed" },
  investigating: {
    plan_submitted: "awaiting_plan_approval",
    cms_changes_submitted: "reviewing",
    input_needed: "needs_input",
    not_fixable: "not_fixable",
    fail: "failed",
    cancel: "cancelled",
  },
  needs_input: {
    inputs_submitted: "awaiting_plan_approval",
    revise_plan: "investigating",
    cancel: "cancelled",
    fail: "failed",
  },
  awaiting_plan_approval: {
    approve_plan: "implementing",
    revise_plan: "investigating",
    input_needed: "needs_input",
    base_moved: "stale",
    cancel: "cancelled",
  },
  implementing: {
    patch_submitted: "reviewing",
    not_fixable: "not_fixable",
    base_moved: "stale",
    fail: "failed",
    cancel: "cancelled",
  },
  reviewing: {
    review_passed: "validating",
    review_revise: "correcting",
    fail: "failed",
    cancel: "cancelled",
  },
  validating: {
    validation_passed: "awaiting_patch_approval",
    validation_failed: "correcting",
    fail: "failed",
    cancel: "cancelled",
  },
  correcting: {
    correction_started: "implementing",
    patch_submitted: "reviewing",
    fail: "failed",
    cancel: "cancelled",
  },
  awaiting_patch_approval: {
    apply_started: "applying",
    proposal_rejected: "cancelled",
    base_moved: "stale",
    cancel: "cancelled",
  },
  applying: {
    pr_opened: "pr_open",
    applied_live: "rescan_pending",
    base_moved: "stale",
    fail: "failed",
  },
  pr_open: { pr_merged: "merged", pr_closed: "closed", cancel: "cancelled" },
  closed: { pr_reopened: "pr_open", pr_merged: "merged" },
  merged: { verification_started: "rescan_pending" },
  rescan_pending: {
    verified: "verified_fixed",
    not_verified: "not_verified",
    rolled_back: "closed",
    fail: "failed",
  },
  verified_fixed: { rolled_back: "closed" },
  not_verified: { rolled_back: "closed" },
};

export function nextStatus(from: AgentRunStatus, event: AgentEvent): AgentRunStatus | null {
  return T[from]?.[event] ?? null;
}

export function isTerminal(status: AgentRunStatus): boolean {
  return AGENT_TERMINAL_STATUSES.includes(status);
}

/** Retry is offered for runs that ended without a fix and without an open PR. */
export function canRetry(status: AgentRunStatus): boolean {
  return ["failed", "stale", "not_fixable", "cancelled", "not_verified", "closed"].includes(status);
}

/** Cancel while nothing irreversible is under way (an open PR is closed by cancel). */
export function canCancel(status: AgentRunStatus): boolean {
  return (
    !isTerminal(status) &&
    status !== "applying" &&
    status !== "merged" &&
    status !== "rescan_pending"
  );
}

/** The run's status once its proposal / verification rows move on (they are the source of truth). */
export function statusFromProposal(
  current: AgentRunStatus,
  proposal: ProposalStatus | null,
  verification: VerificationStatus | null,
): AgentRunStatus {
  if (!proposal) return current;
  switch (proposal) {
    case "draft":
      return current === "awaiting_patch_approval" ? current : current;
    case "applying":
      return "applying";
    case "pr_open":
      return "pr_open";
    case "merged":
      return "merged";
    case "verifying":
    case "applied":
      return "rescan_pending";
    case "rolled_back":
      return "closed";
    case "verified":
      return "verified_fixed";
    case "not_verified":
      return "not_verified";
    case "closed":
      return "closed";
    case "stale":
      return "stale";
    case "discarded":
      return isTerminal(current) ? current : "cancelled";
    case "failed":
    case "access_lost":
      return "failed";
    default:
      return verification === "verified" ? "verified_fixed" : current;
  }
}

const LABEL: Record<TimelineStepId, string> = {
  detected: "Detected",
  investigating: "Investigating",
  plan_ready: "Plan ready",
  awaiting_approval: "Awaiting approval",
  implementing: "Implementing",
  validating: "Validating",
  pr_created: "Pull request created",
  rescan_pending: "Re-scan pending",
  verified_fixed: "Verified fixed",
};

const ORDER: TimelineStepId[] = [
  "detected",
  "investigating",
  "plan_ready",
  "awaiting_approval",
  "implementing",
  "validating",
  "pr_created",
  "rescan_pending",
  "verified_fixed",
];

/** Which step each status sits on. */
const STEP_OF: Record<AgentRunStatus, TimelineStepId> = {
  queued: "investigating",
  investigating: "investigating",
  needs_input: "plan_ready",
  not_fixable: "plan_ready",
  awaiting_plan_approval: "awaiting_approval",
  implementing: "implementing",
  reviewing: "validating",
  validating: "validating",
  correcting: "implementing",
  awaiting_patch_approval: "validating",
  applying: "pr_created",
  pr_open: "pr_created",
  closed: "pr_created",
  stale: "implementing",
  merged: "rescan_pending",
  rescan_pending: "rescan_pending",
  not_verified: "rescan_pending",
  verified_fixed: "verified_fixed",
  failed: "investigating",
  cancelled: "investigating",
};

export type TimelineInput = {
  status: AgentRunStatus;
  detectedAt: string | null;
  createdAt: string;
  planReadyAt: string | null;
  planApprovedAt: string | null;
  proposalCreatedAt: string | null;
  prOpenedAt: string | null;
  mergedAt: string | null;
  verifiedAt: string | null;
  /** Step reached before a failure/cancel (for failed runs). */
  failedAtStep?: TimelineStepId | null;
  /** CMS runs relabel the plan and pull-request steps. */
  provider?: "github" | "wordpress" | "webflow";
  statusDetail?: string | null;
};

export function timelineFor(run: TimelineInput): TimelineStep[] {
  const failed = ["failed", "cancelled", "stale", "not_verified", "not_fixable", "closed"].includes(
    run.status,
  );
  const currentStep =
    (run.status === "failed" || run.status === "cancelled") && run.failedAtStep
      ? run.failedAtStep
      : STEP_OF[run.status];
  const idx = ORDER.indexOf(currentStep);
  const waiting = [
    "needs_input",
    "awaiting_plan_approval",
    "awaiting_patch_approval",
    "pr_open",
    "merged",
  ].includes(run.status);
  const at: Partial<Record<TimelineStepId, string | null>> = {
    detected: run.detectedAt,
    investigating: run.createdAt,
    plan_ready: run.planReadyAt,
    awaiting_approval: run.planApprovedAt,
    validating: run.proposalCreatedAt,
    pr_created: run.prOpenedAt,
    rescan_pending: run.mergedAt,
    verified_fixed: run.verifiedAt,
  };
  const cms =
    run.provider && run.provider !== "github"
      ? run.provider === "webflow"
        ? "Webflow"
        : "WordPress"
      : null;
  const label = (id: TimelineStepId) =>
    cms && id === "pr_created"
      ? `Changed on ${cms}`
      : cms && id === "plan_ready"
        ? "Change prepared"
        : cms && id === "implementing"
          ? "Writing the change"
          : LABEL[id];
  return ORDER.map((id, i) => {
    let state: TimelineStep["state"];
    if (run.status === "verified_fixed") state = "done";
    else if (i < idx) state = "done";
    else if (i > idx) state = run.status === "not_fixable" && i > idx ? "skipped" : "todo";
    else if (failed) state = "failed";
    else if (waiting) state = "waiting";
    else state = "current";
    // Plan ready is reached once a plan exists, even while waiting on approval.
    if (id === "plan_ready" && run.planReadyAt && state === "todo") state = "done";
    return {
      id,
      label: label(id),
      state,
      at:
        state === "done" || state === "current" || state === "waiting" || state === "failed"
          ? (at[id] ?? null)
          : null,
      detail: i === idx ? (run.statusDetail ?? null) : null,
    };
  });
}
