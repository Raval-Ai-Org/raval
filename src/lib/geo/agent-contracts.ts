// agent-contracts.ts — the JSON shapes of the Mellox GEO Engineer (the coding
// agent that investigates a repository, plans a fix, and produces a patch that
// becomes a pull request). Type-only and browser-safe; built by
// src/server/geo/agents/present.ts. Every field comes from real execution —
// there is no simulated activity.

import type { FixProposalView, ProposalValidation, VerificationView } from "./fix-contracts";

export const GEO_AGENT_NAME = "Mellox GEO Engineer";

export type AgentRunStatus =
  | "queued"
  | "investigating"
  | "needs_input"
  | "awaiting_plan_approval"
  | "implementing"
  | "reviewing"
  | "validating"
  | "correcting"
  | "awaiting_patch_approval"
  | "applying"
  | "pr_open"
  | "merged"
  | "rescan_pending"
  | "verified_fixed"
  | "not_verified"
  | "not_fixable"
  | "failed"
  | "cancelled"
  | "closed"
  | "stale";

/** States a worker advances (claimable). */
export const AGENT_WORKER_STATUSES: readonly AgentRunStatus[] = [
  "queued",
  "investigating",
  "implementing",
  "reviewing",
  "validating",
  "correcting",
];

/** States waiting on a person. */
export const AGENT_WAITING_STATUSES: readonly AgentRunStatus[] = [
  "needs_input",
  "awaiting_plan_approval",
  "awaiting_patch_approval",
];

export const AGENT_TERMINAL_STATUSES: readonly AgentRunStatus[] = [
  "verified_fixed",
  "not_verified",
  "not_fixable",
  "failed",
  "cancelled",
  "closed",
  "stale",
];

export type AgentStage =
  "investigate" | "implement" | "review" | "validate" | "correct" | "apply" | "verify";

export type AgentPlanFile = {
  path: string;
  action: "create" | "update";
  /** Why this file — from what the agent actually read. */
  reason: string;
  evidence: { path: string; line: number | null; note: string }[];
};

export type AgentInputRequest = {
  key: string;
  label: string;
  why: string;
  example: string;
};

export type AgentPlan = {
  feasible: boolean;
  /** When not feasible: why it can't be automated. */
  notFixableReason: string | null;
  /** Always present: what a person would do by hand, and how to confirm it. */
  manualSteps: string[];
  strategy: string;
  scope: "page" | "site" | "template";
  summary: string;
  files: AgentPlanFile[];
  risks: string[];
  outOfScope: string[];
  validationCriteria: string[];
  needsInput: AgentInputRequest[];
  verification: { scope: "page" | "site" | "full"; urls: string[] };
  confidence: "high" | "medium" | "low";
};

export type AgentReviewIssue = {
  severity: "blocker" | "major" | "minor";
  category: "correctness" | "security" | "regression" | "fabrication" | "scope";
  path: string | null;
  detail: string;
  suggestion: string;
};

export type AgentReview = {
  verdict: "approve" | "revise";
  summary: string;
  issues: AgentReviewIssue[];
};

export type AgentPatchFile = {
  path: string;
  action: "create" | "update";
  diff: string;
  additions: number;
  deletions: number;
  explanation: string;
};

export type AgentUsage = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

export type AgentEventKind =
  | "stage_started"
  | "tool_call"
  | "model_turn"
  | "plan_ready"
  | "input_requested"
  | "inputs_received"
  | "approval"
  | "review"
  | "validation"
  | "correction"
  | "proposal"
  | "pr"
  | "checks"
  | "preview"
  | "verification"
  | "cancel"
  | "retry"
  | "error"
  | "result";

export type AgentEventView = {
  id: number;
  at: string;
  stage: AgentStage | null;
  kind: AgentEventKind;
  actor: "agent" | "system" | "user";
  summary: string;
  detail: Record<string, unknown>;
};

export type AgentFileInspected = {
  path: string;
  reason: string;
  lines: string | null;
  via: "read_file" | "search_code" | "list_tree";
};

export type TimelineStepId =
  | "detected"
  | "investigating"
  | "plan_ready"
  | "awaiting_approval"
  | "implementing"
  | "validating"
  | "pr_created"
  | "rescan_pending"
  | "verified_fixed";

export type TimelineStep = {
  id: TimelineStepId;
  label: string;
  state: "done" | "current" | "waiting" | "todo" | "failed" | "skipped";
  at: string | null;
  detail: string | null;
};

export type AgentRunView = {
  id: string;
  agentName: typeof GEO_AGENT_NAME;
  model: string | null;
  status: AgentRunStatus;
  statusDetail: string | null;
  error: { code: string | null; message: string } | null;
  fingerprint: string;
  ruleId: string;
  pageUrl: string | null;
  repository: string | null;
  baseBranch: string | null;
  baseSha: string | null;
  framework: string | null;
  plan: AgentPlan | null;
  planHash: string | null;
  planRevision: number;
  planApprovedAt: string | null;
  inputs: Record<string, { value: string; at: string }>;
  filesInspected: AgentFileInspected[];
  patch: { explanation: string; files: AgentPatchFile[] } | null;
  review: AgentReview | null;
  validation: ProposalValidation | null;
  correctionRounds: number;
  proposal: FixProposalView | null;
  verification: VerificationView | null;
  usage: AgentUsage | null;
  timeline: TimelineStep[];
  /** What the person can do now (server-decided). */
  actions: {
    approvePlan: boolean;
    revisePlan: boolean;
    submitInputs: boolean;
    approvePatch: boolean;
    cancel: boolean;
    retry: boolean;
  };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
