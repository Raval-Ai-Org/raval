// approvals.ts — the human approval gate for agent-proposed actions (audit
// §30.2 "Approval drawer"). A member approves ONE request id; the platform
// re-checks policy and role at that moment, executes the tool exactly once
// (compare-and-set on status + the request's idempotency key), and records the
// outcome. Rejections and expiries are recorded too. Nothing here is callable
// by a worker — only by an authenticated member through /api/agents/actions.
import "server-only";
import type { WorkspaceRole } from "@/server/api-auth";
import { invokeTool } from "./runtime";
import type { AgentStore } from "./store";
import { ToolError, type ActionRequest } from "./types";

export type ApprovalOutcome =
  | { ok: true; status: "executed"; result: unknown }
  | {
      ok: false;
      status: "failed" | "expired" | "not_found" | "conflict" | "denied";
      error: string;
    };

export async function approveAction(args: {
  store: AgentStore;
  db: any;
  requestId: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  reason?: string;
  now?: () => Date;
}): Promise<ApprovalOutcome> {
  const now = args.now ?? (() => new Date());
  const req = await args.store.getActionRequest(args.requestId);
  // A request from another workspace is indistinguishable from a missing one.
  if (!req || req.workspaceId !== args.workspaceId) {
    return { ok: false, status: "not_found", error: "Action request not found" };
  }
  if (req.status !== "suggested") {
    return { ok: false, status: "conflict", error: `Already ${req.status}` };
  }
  if (new Date(req.expiresAt).getTime() <= now().getTime()) {
    await args.store.updateActionRequest(req.id, { status: "expired" }, "suggested");
    return { ok: false, status: "expired", error: "This suggestion has expired" };
  }

  // Claim it: only one approver can move suggested → approved.
  const claimed = await args.store.updateActionRequest(
    req.id,
    { status: "approved", decidedBy: args.userId, decisionReason: args.reason ?? null },
    "suggested",
  );
  if (!claimed)
    return { ok: false, status: "conflict", error: "Someone else already decided this" };

  try {
    const result = await invokeTool(
      {
        workspaceId: args.workspaceId,
        actor: { kind: "user", userId: args.userId, role: args.role },
        runId: req.runId ?? undefined,
        db: args.db,
        now,
      },
      req.tool,
      req.args,
      { store: args.store, approvalGranted: true, idempotencyKey: req.idempotencyKey },
    );
    if (result.status !== "ok") throw new ToolError("failed", "Tool did not execute");
    await args.store.updateActionRequest(req.id, {
      status: "executed",
      result: result.output,
      error: null,
    });
    return { ok: true, status: "executed", result: result.output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const denied = error instanceof ToolError && error.code === "denied";
    // A denial (e.g. role) returns the request to `suggested` for someone who may approve it.
    await args.store.updateActionRequest(
      req.id,
      denied
        ? { status: "suggested", decidedBy: null, decisionReason: null }
        : { status: "failed", error: message.slice(0, 500) },
    );
    return { ok: false, status: denied ? "denied" : "failed", error: message };
  }
}

export async function rejectAction(args: {
  store: AgentStore;
  requestId: string;
  workspaceId: string;
  userId: string;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const req: ActionRequest | null = await args.store.getActionRequest(args.requestId);
  if (!req || req.workspaceId !== args.workspaceId)
    return { ok: false, error: "Action request not found" };
  const ok = await args.store.updateActionRequest(
    req.id,
    { status: "rejected", decidedBy: args.userId, decisionReason: args.reason ?? null },
    "suggested",
  );
  return ok ? { ok } : { ok, error: `Already ${req.status}` };
}
