import "server-only";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { rateLimitFor } from "@/server/rate-limit";
import { z } from "zod";

const uuid = z.string().uuid();
const service = () => import("@/server/connectors/wix/service.server");

export const getWixConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return (await service()).getConnectionView(context.supabase, data.workspaceId);
  });

export const startWixConnect = createServerFn({ method: "POST" })
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
    return (await service()).createInstallUrl({ ...data, userId: context.userId });
  });

export const completeWixConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-complete")])
  .inputValidator((data) =>
    z
      .object({
        state: z.string().min(32).max(128),
        instanceId: z.string().uuid(),
        signedInstance: z.string().min(16).max(4096),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const svc = await service();
    const state = await svc.readState(data.state, context.userId);
    await requireWorkspaceRole(context, state.workspaceId, "admin");
    return svc.completeConnect(
      state,
      { instanceId: data.instanceId, signedInstance: data.signedInstance },
      context.userId,
    );
  });

export const refreshWixSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).refreshSite(data.workspaceId);
  });

export const disconnectWix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, connectionId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).disconnect({ ...data, userId: context.userId });
  });
