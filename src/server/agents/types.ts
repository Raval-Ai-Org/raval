// types.ts — contracts of the agent control plane (audit §16–19, §29).
//
// The model may recommend; the platform validates, authorizes, executes,
// persists and audits. Every capability an agent can use is a typed Tool with
// an explicit effect class, minimum role, timeout and idempotency contract.
// Tools receive a workspace-scoped context — never raw credentials, never SQL,
// never another tenant.
import "server-only";
import type { ZodType, ZodTypeDef } from "zod";
import type { WorkspaceRole } from "@/server/api-auth";

/** What calling the tool does to the world. */
export type ToolEffect =
  /** Reads workspace-scoped data. */
  | "read"
  /** Produces a proposal/draft in memory; changes nothing. */
  | "draft"
  /** Changes this workspace's data. Always requires human approval. */
  | "write"
  /** Acts outside the product (publish, send, OAuth). No such tool exists yet. */
  | "external";

export type PolicyDecision = "allow" | "require_approval" | "deny";

/** Who is acting: a signed-in member, or a worker acting for a workspace. */
export type AgentActor =
  | { kind: "user"; userId: string; role: WorkspaceRole }
  | { kind: "worker"; worker: string };

export type ToolContext = {
  workspaceId: string;
  actor: AgentActor;
  runId?: string;
  /** Data access for tool handlers. Every query MUST be scoped to workspaceId. */
  db: any;
  now: () => Date;
};

type Schema<T> = ZodType<T, ZodTypeDef, unknown>;

export type ToolDefinition<I = any, O = any> = {
  name: string;
  description: string;
  effect: ToolEffect;
  /** Minimum member role for a USER actor (workers act at "viewer" for reads). */
  minRole: WorkspaceRole;
  input: Schema<I>;
  output: Schema<O>;
  timeoutMs: number;
  /** Safe to retry with the same idempotency key without double effects. */
  idempotent: boolean;
  /** Short, human-readable preview of what an approval would change. */
  preview?: (input: I, ctx: ToolContext) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Record ids the call affects (shown in the approval drawer). */
  affects?: (input: I) => Array<{ table: string; id: string }>;
  handler: (input: I, ctx: ToolContext) => Promise<O>;
};

export type WorkspaceAgentSettings = {
  agentsPaused: boolean;
  disabledWorkers: string[];
};

export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RunBudget = {
  maxSteps: number;
  deadlineMs: number;
  maxCostUsd: number;
};

export type FindingSeverity = "low" | "medium" | "high" | "critical";

/** The audit's §29.2 finding contract. */
export type Finding = {
  fingerprint: string;
  severity: FindingSeverity;
  title: string;
  summary: string;
  evidence: string[];
  hypotheses: string[];
  affected: Array<{ table: string; id: string }>;
  recommendedAction: string;
  requiresHumanApproval: boolean;
  confidence: number;
};

export type ActionRequestStatus =
  | "suggested"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired";

export type ActionRequest = {
  id: string;
  workspaceId: string;
  runId: string | null;
  source: "worker" | "chat" | "user";
  tool: string;
  args: Record<string, unknown>;
  title: string;
  preview: Record<string, unknown>;
  affectedRecords: Array<{ table: string; id: string }>;
  status: ActionRequestStatus;
  idempotencyKey: string;
  expiresAt: string;
  decidedBy?: string | null;
  decisionReason?: string | null;
  result?: unknown;
  error?: string | null;
};

export class ToolError extends Error {
  constructor(
    readonly code:
      | "unknown_tool"
      | "invalid_input"
      | "invalid_output"
      | "denied"
      | "timeout"
      | "not_found"
      | "failed"
      | "budget",
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
