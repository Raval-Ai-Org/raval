import "server-only";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { rateLimitFor } from "@/server/rate-limit";
import { z } from "zod";

const uuid = z.string().uuid();
const service = () => import("@/server/connectors/wordpress/service.server");
const credentials = z.object({
  workspaceId: uuid,
  siteUrl: z.string().min(1).max(500),
  username: z.string().min(1).max(200),
  applicationPassword: z.string().min(1).max(300),
});

export const getWordPressConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return (await service()).getConnectionView(context.supabase, data.workspaceId);
  });

export const connectWordPress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((data) => credentials.parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).connect({ ...data, userId: context.userId });
  });

export const startWordPressOAuth = createServerFn({ method: "POST" })
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
    return (await service()).createOAuthUrl({ ...data, userId: context.userId });
  });

export const completeWordPressOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-complete")])
  .inputValidator((data) =>
    z.object({ state: z.string().min(32).max(128), code: z.string().min(3).max(2048) }).parse(data),
  )
  .handler(async ({ data, context }) =>
    (await service()).completeOAuth({ ...data, userId: context.userId }),
  );

export const refreshWordPress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).refresh({ ...data, userId: context.userId });
  });

export const selectWordPressSite = createServerFn({ method: "POST" })
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

export const disconnectWordPress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, connectionId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return (await service()).disconnect({ ...data, userId: context.userId });
  });

export const getWordPressData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        kind: z.enum(["posts", "pages", "media", "categories", "tags"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return (await service()).data(data.workspaceId, data.kind);
  });

const publishInput = z
  .object({
    workspaceId: uuid,
    kind: z.enum(["post", "page"]),
    operation: z.enum(["create", "update"]),
    id: z.number().int().positive().optional(),
    body: z.record(z.string(), z.unknown()),
  })
  .superRefine((value, ctx) => {
    if (value.operation === "update" && value.id === undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An id is required to update content.",
      });
  });
export const publishWordPress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => publishInput.parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    return (await service()).publish(
      data.workspaceId,
      data.kind,
      data.operation,
      data.id,
      data.body,
    );
  });
