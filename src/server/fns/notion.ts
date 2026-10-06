import "server-only";
import { z } from "zod";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { rateLimitFor } from "@/server/rate-limit";
const uuid = z.string().uuid();
const workspace = z.object({ workspaceId: uuid });
const service = () => import("@/server/connectors/notion/service.server");

export const getNotionConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return (await service()).notionStatus(data.workspaceId);
  });
export const startNotionConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((v) => workspace.extend({ returnPath: z.string().max(300).optional() }).parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    return {
      url: await (
        await import("@/server/connectors/notion/oauth.server")
      ).startNotionOAuth(context.userId, data.workspaceId, data.returnPath),
    };
  });
export const disconnectNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const notion = await service();
    await notion.withNotionSyncLock(data.workspaceId, () =>
      notion.disconnectNotion(data.workspaceId, context.userId),
    );
    return { disconnected: true };
  });
export const listNotionDestinations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return (await service()).listNotionDestinations(data.workspaceId);
  });
export const selectNotionDestination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((v) =>
    workspace.extend({ dataSourceId: uuid, addColumns: z.boolean().optional() }).parse(v),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const notion = await service();
    return notion.withNotionSyncLock(data.workspaceId, () =>
      notion.selectNotionDestination(
        data.workspaceId,
        context.userId,
        data.dataSourceId,
        data.addColumns === true,
      ),
    );
  });
export const createNotionDestination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((v) => workspace.extend({ parentPageId: uuid }).parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const notion = await service();
    return notion.withNotionSyncLock(data.workspaceId, () =>
      notion.createNotionDestination(data.workspaceId, context.userId, data.parentPageId),
    );
  });
export const exportToNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((v) =>
    workspace.extend({ contentIds: z.array(uuid).max(500).optional() }).parse(v),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const notion = await service();
    return notion.withNotionSyncLock(data.workspaceId, () =>
      notion.exportNotion(data.workspaceId, context.userId, data.contentIds),
    );
  });
export const previewNotionImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    return (await service()).previewNotionImport(data.workspaceId);
  });
export const importFromNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((v) => workspace.extend({ pageIds: z.array(uuid).max(5000) }).parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const notion = await service();
    return notion.withNotionSyncLock(data.workspaceId, () =>
      notion.importNotion(data.workspaceId, context.userId, context.supabase, data.pageIds),
    );
  });
export const syncNotionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const notion = await service();
    return notion.withNotionSyncLock(data.workspaceId, () =>
      notion.syncNotion(data.workspaceId, context.userId, context.supabase),
    );
  });
export const listNotionConflicts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return (await service()).notionConflicts(data.workspaceId);
  });
export const resolveNotionConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((v) =>
    workspace.extend({ mappingId: uuid, keep: z.enum(["mellox", "notion"]) }).parse(v),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const notion = await service();
    return notion.withNotionSyncLock(data.workspaceId, () =>
      notion.resolveNotionConflict(
        data.workspaceId,
        context.userId,
        context.supabase,
        data.mappingId,
        data.keep,
      ),
    );
  });
