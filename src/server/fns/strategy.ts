import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import type { ServerFnContext } from "@/server/server-fn";
import type { WorkspaceRole } from "@/server/api-auth";
import type { StrategyView } from "@/lib/strategy/contracts";

// Marketing Strategy (ADR-0032, src/server/strategy/). Reading needs
// membership; writing, editing and confirming need editor. The first strategy
// Mellox writes for a workspace is included; a rebuild is charged.

const uuid = z.string().uuid();
const ws = { workspaceId: uuid };
const svc = () => import("@/server/strategy/service.server");

async function caller(context: ServerFnContext, workspaceId: string, minRole: WorkspaceRole) {
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return { workspaceId, userId: context.userId, role };
}

export const getStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }): Promise<StrategyView> => {
    const c = await caller(context, data.workspaceId, "viewer");
    return (await svc()).getStrategyView(c);
  });

/** Write (or rewrite) the strategy from the four brains. It lands as a draft. */
export const generateStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audit")])
  .inputValidator((data) =>
    z
      .object({ ...ws, note: z.string().trim().max(1000).optional(), idempotencyKey: uuid })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<StrategyView> => {
    const c = await caller(context, data.workspaceId, "editor");
    const service = await svc();
    const { HttpError } = await import("@/server/http-error");
    const unusable = () =>
      new HttpError(502, "Mellox couldn't write a strategy this time. Nothing was charged.");

    if (!(await service.hasGenerated(c.workspaceId))) {
      // The first one is included with every plan.
      if (!(await service.buildStrategy(c, data.note))) throw unusable();
    } else {
      const { runMetered } = await import("@/server/billing/metered.server");
      const metered = await runMetered(
        {
          workspaceId: c.workspaceId,
          userId: c.userId,
          role: c.role,
          action: "strategy_rebuild",
          idempotencyKey: data.idempotencyKey,
          route: "strategy.generate",
        },
        async (charge) => {
          const ok = await service.buildStrategy(c, data.note);
          if (!ok) charge.setCapturedAmount(0);
          return ok;
        },
      );
      if (!metered.result) throw unusable();
    }
    return service.getStrategyView(c);
  });

/** Save edits; with `confirm`, make it the strategy Mellox follows. Free. */
export const saveStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audience-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        strategy: z.record(z.string(), z.unknown()),
        version: z.number().int().min(1),
        confirm: z.boolean().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<StrategyView> => {
    const c = await caller(context, data.workspaceId, "editor");
    const service = await svc();
    await service.saveStrategy(c, data);
    const { invalidateStudioContext } = await import("@/server/studio/context.server");
    invalidateStudioContext(c.workspaceId);
    return service.getStrategyView(c);
  });
