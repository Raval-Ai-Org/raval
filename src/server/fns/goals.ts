import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import type { ServerFnContext } from "@/server/server-fn";
import type { GoalsView } from "@/lib/goals/contracts";
import type { GoalWarning } from "@/lib/goals/decide";

// Goals (ADR-0035, src/server/goals/). Reading needs membership; setting the
// goal needs editor. Every save goes through decideGoals on the server.

const uuid = z.string().uuid();
const svc = () => import("@/server/goals/service.server");

async function requireRole(
  context: ServerFnContext,
  workspaceId: string,
  minRole: "viewer" | "editor",
) {
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  return requireWorkspaceRole(context, workspaceId, minRole);
}

export const getGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<GoalsView> => {
    await requireRole(context, data.workspaceId, "viewer");
    return (await svc()).getGoalsView(data.workspaceId);
  });

export const saveGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, goals: z.record(z.string(), z.unknown()) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<GoalsView & { warnings: GoalWarning[] }> => {
    await requireRole(context, data.workspaceId, "editor");
    const saved = await (
      await svc()
    ).saveGoals({
      workspaceId: data.workspaceId,
      userId: context.userId,
      goals: data.goals,
    });
    const { invalidateStudioContext } = await import("@/server/studio/context.server");
    invalidateStudioContext(data.workspaceId);
    return saved;
  });
