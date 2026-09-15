import { describe, expect, it } from "vitest";
import {
  canCancel,
  canRetry,
  isTerminal,
  nextStatus,
  statusFromProposal,
  timelineFor,
  type TimelineInput,
} from "./agent-state";

const run = (over: Partial<TimelineInput>): TimelineInput => ({
  status: "queued",
  detectedAt: "2026-09-15T10:00:00Z",
  createdAt: "2026-09-15T10:01:00Z",
  planReadyAt: null,
  planApprovedAt: null,
  proposalCreatedAt: null,
  prOpenedAt: null,
  mergedAt: null,
  verifiedAt: null,
  ...over,
});

describe("agent state machine", () => {
  it("follows the happy path from queue to verified fix", () => {
    const path = [
      ["queued", "start", "investigating"],
      ["investigating", "plan_submitted", "awaiting_plan_approval"],
      ["awaiting_plan_approval", "approve_plan", "implementing"],
      ["implementing", "patch_submitted", "reviewing"],
      ["reviewing", "review_passed", "validating"],
      ["validating", "validation_passed", "awaiting_patch_approval"],
      ["awaiting_patch_approval", "apply_started", "applying"],
      ["applying", "pr_opened", "pr_open"],
      ["pr_open", "pr_merged", "merged"],
      ["merged", "verification_started", "rescan_pending"],
      ["rescan_pending", "verified", "verified_fixed"],
    ] as const;
    for (const [from, event, to] of path) expect(nextStatus(from, event)).toBe(to);
  });

  it("loops through correction and input requests", () => {
    expect(nextStatus("validating", "validation_failed")).toBe("correcting");
    expect(nextStatus("reviewing", "review_revise")).toBe("correcting");
    expect(nextStatus("correcting", "correction_started")).toBe("implementing");
    expect(nextStatus("investigating", "input_needed")).toBe("needs_input");
    expect(nextStatus("needs_input", "inputs_submitted")).toBe("awaiting_plan_approval");
    expect(nextStatus("awaiting_plan_approval", "revise_plan")).toBe("investigating");
  });

  it("refuses illegal jumps", () => {
    expect(nextStatus("investigating", "apply_started")).toBeNull();
    expect(nextStatus("awaiting_plan_approval", "pr_opened")).toBeNull();
    expect(nextStatus("queued", "verified")).toBeNull();
    // Nothing but verification resolves a run.
    expect(nextStatus("pr_open", "verified")).toBeNull();
    expect(nextStatus("verified_fixed", "start")).toBeNull();
    expect(nextStatus("applying", "cancel")).toBeNull();
  });

  it("classifies terminal, retryable and cancellable states", () => {
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("pr_open")).toBe(false);
    expect(canRetry("failed")).toBe(true);
    expect(canRetry("pr_open")).toBe(false);
    expect(canCancel("pr_open")).toBe(true);
    expect(canCancel("applying")).toBe(false);
    expect(canCancel("verified_fixed")).toBe(false);
  });

  it("mirrors proposal and verification rows", () => {
    expect(statusFromProposal("awaiting_patch_approval", "pr_open", null)).toBe("pr_open");
    expect(statusFromProposal("pr_open", "verifying", "running")).toBe("rescan_pending");
    expect(statusFromProposal("rescan_pending", "verified", "verified")).toBe("verified_fixed");
    expect(statusFromProposal("rescan_pending", "not_verified", "not_verified")).toBe(
      "not_verified",
    );
    expect(statusFromProposal("awaiting_patch_approval", "discarded", null)).toBe("cancelled");
    expect(statusFromProposal("investigating", null, null)).toBe("investigating");
  });
});

describe("timeline", () => {
  it("marks progress, waiting and failure from real state only", () => {
    const waiting = timelineFor(
      run({ status: "awaiting_plan_approval", planReadyAt: "2026-09-15T10:03:00Z" }),
    );
    expect(waiting.map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "waiting",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
    const failed = timelineFor(
      run({ status: "failed", failedAtStep: "validating", statusDetail: "Syntax" }),
    );
    expect(failed.find((s) => s.id === "validating")).toMatchObject({
      state: "failed",
      detail: "Syntax",
    });
    expect(failed.find((s) => s.id === "pr_created")?.state).toBe("todo");
    const done = timelineFor(run({ status: "verified_fixed", verifiedAt: "2026-09-16T10:00:00Z" }));
    expect(done.every((s) => s.state === "done")).toBe(true);
  });

  it("skips later steps when the finding can't be fixed automatically", () => {
    const t = timelineFor(run({ status: "not_fixable", planReadyAt: "2026-09-15T10:03:00Z" }));
    expect(t.find((s) => s.id === "plan_ready")?.state).toBe("failed");
    expect(t.find((s) => s.id === "implementing")?.state).toBe("skipped");
  });
});
