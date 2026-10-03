import "server-only";
import { z } from "zod";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { rateLimitFor } from "@/server/rate-limit";

const uuid = z.string().uuid();
const workspace = z.object({ workspaceId: uuid });

export const getCanvaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => workspace.parse(value))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { canvaStatus } = await import("@/server/connectors/canva/service.server");
    return canvaStatus(data.workspaceId);
  });

export const startCanvaConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((value) =>
    workspace.extend({ returnPath: z.string().max(300).optional() }).parse(value),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { startCanvaOAuth } = await import("@/server/connectors/canva/oauth.server");
    return {
      url: await startCanvaOAuth({
        userId: context.userId,
        workspaceId: data.workspaceId,
        returnPath: data.returnPath,
      }),
    };
  });

export const completeCanvaConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-complete")])
  .inputValidator((value) =>
    z
      .object({ state: z.string().min(32).max(128), code: z.string().min(1).max(2048) })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { completeCanvaOAuth } = await import("@/server/connectors/canva/service.server");
    return completeCanvaOAuth({
      ...data,
      userId: context.userId,
      authorize: async (workspaceId) => {
        await requireWorkspaceRole(context, workspaceId, "editor");
      },
    });
  });

export const removeCanvaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((value) => workspace.parse(value))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { disconnectCanva } = await import("@/server/connectors/canva/service.server");
    await disconnectCanva(data.workspaceId, context.userId);
    return { disconnected: true };
  });

export const createCanvaEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((value) =>
    workspace
      .extend({ assetId: uuid.optional(), contentId: uuid.optional() })
      .refine((v) => !!(v.assetId || v.contentId))
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { editInCanva } = await import("@/server/connectors/canva/service.server");
    return editInCanva({ ...data, userId: context.userId });
  });

export const getCanvaEditState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) =>
    workspace
      .extend({ assetId: uuid.optional(), contentId: uuid.optional() })
      .refine((v) => !!(v.assetId || v.contentId))
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { canvaEditState } = await import("@/server/connectors/canva/service.server");
    return canvaEditState(data.workspaceId, data);
  });

export const importCanvaVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((value) => workspace.extend({ mappingId: uuid }).parse(value))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { importCanvaChanges } = await import("@/server/connectors/canva/service.server");
    return importCanvaChanges({ ...data, userId: context.userId });
  });

export const selectCanvaVersionAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((value) => workspace.extend({ versionId: uuid }).parse(value))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { selectCanvaVersion } = await import("@/server/connectors/canva/service.server");
    return selectCanvaVersion({ ...data, userId: context.userId });
  });
