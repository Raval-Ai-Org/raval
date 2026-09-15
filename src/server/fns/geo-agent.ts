import "server-only";
import { createServerFn, type ServerFnContext } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { getWorkspaceRole } from "@/server/workspace-access.server";
import { roleAtLeast } from "@/server/api-auth";
import { ForbiddenError } from "@/server/http-error";

// Mellox GEO Engineer (src/server/geo/agents/service.server.ts). Reading needs
// membership; starting, approving, revising, inputs, cancel and retry need
// editor. Patch approval and the pull request use geo-fixes/approveFixProposal.

const uuid = z.string().uuid();

async function agentContext(context: ServerFnContext, workspaceId: string) {
  const role = await getWorkspaceRole(context, workspaceId);
  if (!role) throw new ForbiddenError();
  return {
    supabase: context.supabase,
    userId: context.userId,
    workspaceId,
    canPropose: roleAtLeast(role, "editor"),
    canManage: roleAtLeast(role, "admin"),
  };
}

function requireEditor(ctx: { canPropose: boolean }) {
  if (!ctx.canPropose) throw new ForbiddenError("Editor role required");
}

export const startAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("geo-agent")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        findingId: uuid,
        sourceId: uuid.nullable().optional(),
        baseBranch: z.string().min(1).max(200).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await agentContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/agents/service.server");
    return svc.startAgentRun(ctx, data);
  });

export const getAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, runId: uuid, afterEventId: z.number().int().min(0).optional() })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/agents/service.server");
    return svc.getAgentRun(
      await agentContext(context, data.workspaceId),
      data.runId,
      data.afterEventId,
    );
  });

export const getAgentRunForFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, findingId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/agents/service.server");
    return svc.getAgentRunForFinding(await agentContext(context, data.workspaceId), data.findingId);
  });

export const listAgentRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/agents/service.server");
    return svc.listAgentRuns(await agentContext(context, data.workspaceId), data.scanId);
  });

export const approveAgentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("geo-agent-action")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, runId: uuid, planHash: z.string().regex(/^[0-9a-f]{64}$/) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await agentContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/agents/service.server");
    return svc.approveAgentPlan(ctx, data);
  });

export const reviseAgentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("geo-agent-action")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, runId: uuid, feedback: z.string().trim().min(3).max(1000) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await agentContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/agents/service.server");
    return svc.reviseAgentPlan(ctx, data);
  });

export const submitAgentInputs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("geo-agent-action")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        runId: uuid,
        inputs: z
          .record(z.string().regex(/^[a-z0-9_]{1,60}$/), z.string().max(2000))
          .refine((o) => Object.keys(o).length <= 10, "Too many inputs"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await agentContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/agents/service.server");
    return svc.submitAgentInputs(ctx, data);
  });

export const cancelAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, runId: uuid, closePullRequest: z.boolean().default(false) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await agentContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/agents/service.server");
    return svc.cancelAgentRun(ctx, data);
  });

export const retryAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("geo-agent")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, runId: uuid, fromStage: z.enum(["investigate", "implement"]) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await agentContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/agents/service.server");
    return svc.retryAgentRun(ctx, data);
  });
