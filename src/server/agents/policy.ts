// policy.ts — the deterministic policy decision for every tool call
// (audit §16: "What requires approval? Any publish, schedule, OAuth, reconnect,
// cancellation, credential, or cross-system state change").
//
//   deny              global kill switch (AGENTS_DISABLED), workspace paused,
//                     worker disabled, role below the tool's minimum,
//                     an `external` tool invoked by a worker
//   require_approval  every `write` or `external` effect without a human
//                     approval for THIS action
//   allow             reads and drafts within the actor's role
//
// Approval is per action: an approval granted for one request id never
// authorizes another, whatever the agent was told before.
import "server-only";
import { roleAtLeast } from "@/server/api-auth";
import type { AgentActor, PolicyDecision, ToolDefinition, WorkspaceAgentSettings } from "./types";

export function agentsGloballyDisabled(): boolean {
  const v = (process.env.AGENTS_DISABLED ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export type PolicyResult = { decision: PolicyDecision; reason: string };

export function decidePolicy(
  tool: Pick<ToolDefinition, "name" | "effect" | "minRole">,
  actor: AgentActor,
  settings: WorkspaceAgentSettings,
  opts: { approvalGranted?: boolean } = {},
): PolicyResult {
  if (agentsGloballyDisabled()) {
    return { decision: "deny", reason: "Agents are disabled platform-wide (AGENTS_DISABLED)." };
  }
  if (actor.kind === "worker") {
    if (settings.agentsPaused) {
      return { decision: "deny", reason: "Agents are paused for this workspace." };
    }
    if (settings.disabledWorkers.includes(actor.worker)) {
      return { decision: "deny", reason: `The ${actor.worker} worker is disabled for this workspace.` };
    }
    if (tool.effect === "external") {
      return { decision: "deny", reason: "Workers may never take external actions." };
    }
  } else if (!roleAtLeast(actor.role, tool.minRole)) {
    return {
      decision: "deny",
      reason: `${tool.name} needs the ${tool.minRole} role or higher.`,
    };
  }

  if (tool.effect === "write" || tool.effect === "external") {
    return opts.approvalGranted
      ? { decision: "allow", reason: "Approved by a workspace member for this action." }
      : { decision: "require_approval", reason: `${tool.name} changes workspace data.` };
  }
  return { decision: "allow", reason: `${tool.effect} tool within role.` };
}
