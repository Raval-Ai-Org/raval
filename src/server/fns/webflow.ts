import "server-only";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { rateLimitFor } from "@/server/rate-limit";
import { z } from "zod";

const uuid = z.string().uuid();
const service = () => import("@/server/connectors/webflow/service.server");

export const getWebflowConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return (await service()).getConnectionView(context.supabase, data.workspaceId);
  });

export const startWebflowConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        returnOrigin: z.string().url().max(200).optional(),
        returnPath: z.string().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).createAuthUrl({ ...data, userId: context.userId });
  });

export const completeWebflowConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-complete")])
  .inputValidator((data) =>
    z.object({ state: z.string().min(32).max(128), code: z.string().min(3).max(2048) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const svc = await service();
    const state = await svc.readState(data.state, context.userId);
    await requireWorkspaceRole(context, state.workspaceId, "admin");
    return svc.completeConnect(state, data.code, context.userId);
  });

export const refreshWebflowSites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).listAvailableSites(data.workspaceId);
  });

export const selectWebflowSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, connectionId: uuid, siteId: z.string().min(1).max(100) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).selectSite({ ...data, userId: context.userId });
  });

export const disconnectWebflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, connectionId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).disconnect({ ...data, userId: context.userId });
  });

export const getWebflowData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        kind: z.enum(["pages", "collections", "items"]),
        collectionId: z.string().max(100).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return (await service()).webflowData(data.workspaceId, data.kind, data.collectionId);
  });
