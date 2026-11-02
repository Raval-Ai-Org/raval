import "server-only";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { rateLimitFor } from "@/server/rate-limit";
import { HttpError } from "@/server/http-error";
import { isIntegrationsEnabled } from "@/lib/feature-flags";
import { z } from "zod";

const uuid = z.string().uuid();
const appId = z.string().regex(/^[a-z0-9_-]{2,40}$/);
const service = () => import("@/server/integrations/accounts.server");

function requireEnabled(workspaceId: string) {
  if (!isIntegrationsEnabled(workspaceId)) throw new HttpError(404, "Not found");
}

export const getIntegrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return (await service()).getIntegrationsView(context.supabase, data.workspaceId);
  });

export const startAppConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        app: appId,
        replaces: uuid.optional(),
        returnOrigin: z.string().url().max(200).optional(),
        returnPath: z.string().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    requireEnabled(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).startConnect({ ...data, userId: context.userId });
  });

export const completeAppConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-complete")])
  .inputValidator((data) =>
    z
      .object({
        state: z.string().min(32).max(128),
        connectedAccountId: z.string().regex(/^[A-Za-z0-9_-]{4,80}$/),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const svc = await service();
    const workspaceId = await svc.stateWorkspace(data.state, context.userId);
    requireEnabled(workspaceId);
    await requireWorkspaceRole(context, workspaceId, "admin");
    const result = await svc.completeConnect({ ...data, userId: context.userId });
    return { ...result, workspaceId };
  });

export const disconnectApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, accountId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    requireEnabled(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).disconnect({ ...data, userId: context.userId });
  });
