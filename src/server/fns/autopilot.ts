import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { OPPORTUNITY_FORMATS, ProgramSettingsSchema } from "@/lib/autopilot/contracts";
import { PlatformIdSchema } from "@/lib/studio/jobs";
import type { ServerFnContext } from "@/server/server-fn";
import type { WorkspaceRole } from "@/server/api-auth";

// Autopilot (ADR-0028, src/server/autopilot/). Reading needs membership;
// approving, pausing and acting on an opportunity need editor; starting,
// changing or stopping a program needs admin. With the flag off every
// function except the status check answers 404.

const uuid = z.string().uuid();
const ws = { workspaceId: uuid };
const svc = () => import("@/server/autopilot/service.server");

async function caller(context: ServerFnContext, workspaceId: string, minRole: WorkspaceRole) {
  const service = await svc();
  service.assertAutopilotEnabled(workspaceId);
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return { service, caller: { workspaceId, userId: context.userId, role } };
}

/** Whether Autopilot is on for this workspace (for showing its entry). Never 404s. */
export const getAutopilotStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { isAutopilotEnabled } = await import("@/lib/feature-flags");
    if (!isAutopilotEnabled(data.workspaceId)) return { enabled: false, status: null, waiting: 0 };
    const { getAutopilotBadge } = await svc();
    return { enabled: true, ...(await getAutopilotBadge(data.workspaceId)) };
  });

export const getAutopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "viewer");
    return c.service.getAutopilotView(c.caller);
  });

/**
 * What Mellox proposes for this brand: a short strategy from Brand DNA plus
 * ready-to-go settings. Included work; nothing is saved until Autopilot starts.
 */
export const suggestAutopilotStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => z.object({ ...ws, timezone: z.string().min(1).max(64) }).parse(data))
  .handler(async ({ data, context }) => {
    await caller(context, data.workspaceId, "editor");
    const { suggestStrategy } = await import("@/server/autopilot/strategy.server");
    return suggestStrategy({
      workspaceId: data.workspaceId,
      userId: context.userId,
      timezone: data.timezone,
    });
  });

export const startAutopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => z.object({ ...ws, settings: ProgramSettingsSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "admin");
    await c.service.startProgram(c.caller, data.settings);
    return { ok: true };
  });

export const updateAutopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => z.object({ ...ws, settings: ProgramSettingsSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "admin");
    await c.service.updateProgram(c.caller, data.settings);
    return { ok: true };
  });

export const setAutopilotPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => z.object({ ...ws, paused: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await c.service.setPaused(c.caller, data.paused);
    return { ok: true };
  });

export const stopAutopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "admin");
    await c.service.stopProgram(c.caller);
    return { ok: true };
  });

export const approveAutopilotPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    return c.service.approvePlan(c.caller);
  });

export const decideAutopilotAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) =>
    z.object({ ...ws, actionId: uuid, decision: z.enum(["approve", "skip"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await c.service.decideAction(c.caller, data.actionId, data.decision);
    return { ok: true };
  });

export const retryAutopilotAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => z.object({ ...ws, actionId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await c.service.retryAction(c.caller, data.actionId);
    return { ok: true };
  });

export const decideOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        opportunityId: uuid,
        decision: z.enum(["create", "dismiss"]),
        format: z.enum(OPPORTUNITY_FORMATS).optional(),
        platform: PlatformIdSchema.optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    return c.service.decideOpportunity(c.caller, {
      id: data.opportunityId,
      decision: data.decision,
      format: data.format,
      platform: data.platform,
    });
  });

/**
 * Agency HQ: Autopilot across every workspace the caller belongs to. No
 * workspace id is taken — the rows come from an RPC that runs with the
 * caller's own rights, so membership is the database's decision.
 */
export const getAgencyAutopilot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAgencyAutopilot: load } = await svc();
    return load(context.supabase as never);
  });
