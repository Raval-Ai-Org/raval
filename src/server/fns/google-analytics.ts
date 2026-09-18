import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import type { GoogleConnectionView } from "@/lib/analytics/types";

// Google Analytics 4 + Search Console connector (ADR-0015). Every function
// authenticates the caller and checks their workspace role before the service
// touches Google or writes with the service role. Connect, choose and
// disconnect need admin; Sync now needs editor; reading needs membership.
// Tokens never leave the server.

const uuid = z.string().uuid();

export const getGoogleConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<GoogleConnectionView> => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { getConnectionView } = await import("@/server/analytics/google/service.server");
    return getConnectionView(context.supabase, data.workspaceId);
  });

export const startGoogleConnect = createServerFn({ method: "POST" })
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
    const { createAuthUrl } = await import("@/server/analytics/google/oauth.server");
    const { recordAudit } = await import("@/server/audit.server");
    const result = await createAuthUrl({
      workspaceId: data.workspaceId,
      userId: context.userId,
      returnOrigin: data.returnOrigin ?? null,
      returnPath: data.returnPath ?? null,
    });
    await recordAudit({
      workspaceId: data.workspaceId,
      userId: context.userId,
      action: "connector.google.connect_started",
      entity: "connector",
    });
    return result;
  });

export const completeGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-complete")])
  .inputValidator((data) =>
    z
      .object({
        state: z.string().min(32).max(128),
        code: z.string().min(10).max(1024),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { resolveAuthState, completeConnect } =
      await import("@/server/analytics/google/service.server");
    // The state proves this user started the flow and names the workspace.
    const state = await resolveAuthState(data.state, context.userId);
    await requireWorkspaceRole(context, state.workspaceId, "admin");
    return completeConnect({ state, code: data.code, userId: context.userId });
  });

export const listGa4Properties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { listGa4Properties: list } = await import("@/server/analytics/google/service.server");
    return list(data.workspaceId);
  });

export const listGscSites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { listGscSites: list } = await import("@/server/analytics/google/service.server");
    return list(data.workspaceId);
  });

export const selectGa4Property = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, propertyId: z.string().regex(/^properties\/\d{1,20}$/) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { selectGa4Property: select } = await import("@/server/analytics/google/service.server");
    return select({
      workspaceId: data.workspaceId,
      userId: context.userId,
      propertyId: data.propertyId,
    });
  });

export const selectGscSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, siteUrl: z.string().min(5).max(300) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { selectGscSite: select } = await import("@/server/analytics/google/service.server");
    return select({ workspaceId: data.workspaceId, userId: context.userId, siteUrl: data.siteUrl });
  });

export const removeAnalyticsSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, kind: z.enum(["ga4_property", "gsc_site"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { removeSource } = await import("@/server/analytics/google/service.server");
    await removeSource({ workspaceId: data.workspaceId, userId: context.userId, kind: data.kind });
    return { removed: true };
  });

export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { disconnect } = await import("@/server/analytics/google/service.server");
    return disconnect({ workspaceId: data.workspaceId, userId: context.userId });
  });

export const syncAnalyticsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("analytics-sync")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { syncNow } = await import("@/server/analytics/google/service.server");
    return syncNow({ workspaceId: data.workspaceId, userId: context.userId });
  });

export const getSyncStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("analytics")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<GoogleConnectionView> => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { getConnectionView } = await import("@/server/analytics/google/service.server");
    return getConnectionView(context.supabase, data.workspaceId);
  });
