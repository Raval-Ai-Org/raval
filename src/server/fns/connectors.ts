import "server-only";
import { createServerFn, type ServerFnContext } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { getWorkspaceRole, requireWorkspaceRole } from "@/server/workspace-access.server";
import { roleAtLeast } from "@/server/api-auth";
import { ForbiddenError } from "@/server/http-error";
import {
  CONNECTOR_PROVIDERS,
  type ConnectorsOverview,
  type RepositoryOption,
  type SourceView,
} from "@/lib/connectors/types";

// Connectors (GitHub first). Every function authenticates the caller, checks
// their workspace role, and loads the connection/source through the caller's
// RLS client — so a row id from another workspace simply isn't found — before
// the service writes with the service role. Connect, select and disconnect
// need admin; listing and verifying need editor; reading needs membership.

const uuid = z.string().uuid();

async function loadConnection(context: ServerFnContext, workspaceId: string, connectionId: string) {
  const { CONNECTION_COLS } = await import("@/server/connectors/present");
  const { data, error } = await context.supabase
    .from("workspace_connections")
    .select(CONNECTION_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Connection not found");
  return data as unknown as import("@/server/connectors/present").ConnectionRow;
}

async function loadSource(context: ServerFnContext, workspaceId: string, sourceId: string) {
  const { SOURCE_COLS } = await import("@/server/connectors/present");
  const { data, error } = await context.supabase
    .from("workspace_sources")
    .select(SOURCE_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Source not found");
  const source = data as unknown as import("@/server/connectors/present").SourceRow;
  const connection = await loadConnection(context, workspaceId, source.connection_id);
  return { source, connection };
}

/* ------------------------------------------------------------------ */
/* Overview                                                           */
/* ------------------------------------------------------------------ */

export const getConnectors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<ConnectorsOverview> => {
    const role = await getWorkspaceRole(context, data.workspaceId);
    if (!role) throw new ForbiddenError();
    const [
      { CONNECTION_COLS, SOURCE_COLS, presentConnection, presentSource },
      { getGitHubConfigCheck },
    ] = await Promise.all([
      import("@/server/connectors/present"),
      import("@/server/connectors/github/config.server"),
    ]);
    const [connections, sources] = await Promise.all([
      context.supabase
        .from("workspace_connections")
        .select(CONNECTION_COLS)
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("workspace_sources")
        .select(SOURCE_COLS)
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: true }),
    ]);
    if (connections.error) throw new Error(connections.error.message);
    if (sources.error) throw new Error(sources.error.message);
    const check = getGitHubConfigCheck();
    return {
      providers: CONNECTOR_PROVIDERS,
      configured: {
        github: {
          ready: check.ok && check.config.installVerification !== "unavailable",
          installVerification: check.ok ? check.config.installVerification : "unavailable",
          // Variable names and rules only — never values.
          issues: check.issues,
        },
      },
      connections: (connections.data ?? []).map((r) => presentConnection(r as never)),
      sources: (sources.data ?? []).map((r) => presentSource(r as never)),
      canManage: roleAtLeast(role, "admin"),
    };
  });

/* ------------------------------------------------------------------ */
/* Install                                                            */
/* ------------------------------------------------------------------ */

export const startGithubInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { createInstallUrl } = await import("@/server/connectors/github/service.server");
    return createInstallUrl({ workspaceId: data.workspaceId, userId: context.userId });
  });

export const completeGithubInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((data) =>
    z
      .object({
        state: z.string().min(16).max(256),
        installationId: z.string().regex(/^\d{1,20}$/),
        setupAction: z.enum(["install", "update", "request"]).nullable().optional(),
        code: z.string().max(200).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { consumeInstallState, linkInstallation } =
      await import("@/server/connectors/github/service.server");
    // The state binds the flow to the user who started it and to their workspace.
    const state = await consumeInstallState(data.state, context.userId);
    await requireWorkspaceRole(context, state.workspaceId, "admin");
    const connection = await linkInstallation({
      state,
      installationId: data.installationId,
      code: data.code ?? null,
    });
    return { workspaceId: state.workspaceId, connection };
  });

/* ------------------------------------------------------------------ */
/* Connections                                                        */
/* ------------------------------------------------------------------ */

export const verifyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid, connectionId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const connection = await loadConnection(context, data.workspaceId, data.connectionId);
    const { verifyConnection: verify } = await import("@/server/connectors/github/service.server");
    return verify(connection, context.userId);
  });

export const disconnectConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, connectionId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const connection = await loadConnection(context, data.workspaceId, data.connectionId);
    const { disconnectConnection: disconnect } =
      await import("@/server/connectors/github/service.server");
    await disconnect(connection, context.userId);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Repositories & sources                                             */
/* ------------------------------------------------------------------ */

export const listGithubRepositories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, connectionId: uuid, query: z.string().max(100).optional() })
      .parse(data),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ repositories: RepositoryOption[]; total: number; truncated: boolean }> => {
      await requireWorkspaceRole(context, data.workspaceId, "editor");
      const connection = await loadConnection(context, data.workspaceId, data.connectionId);
      const { listRepositories } = await import("@/server/connectors/github/service.server");
      return listRepositories(connection, context.userId, data.query);
    },
  );

export const selectGithubRepository = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        connectionId: uuid,
        repositoryId: z.string().regex(/^\d{1,20}$/),
        siteUrl: z.string().max(300).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<SourceView> => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const connection = await loadConnection(context, data.workspaceId, data.connectionId);
    const { selectRepository } = await import("@/server/connectors/github/service.server");
    return selectRepository({
      connection,
      userId: context.userId,
      repositoryId: data.repositoryId,
      siteUrl: data.siteUrl,
    });
  });

export const updateSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        sourceId: uuid,
        siteUrl: z.string().max(300).nullable().optional(),
        branch: z.string().max(200).nullable().optional(),
      })
      .refine((v) => v.siteUrl !== undefined || v.branch !== undefined, "Nothing to update")
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<SourceView> => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { source, connection } = await loadSource(context, data.workspaceId, data.sourceId);
    const { updateSource: update } = await import("@/server/connectors/github/service.server");
    return update({
      source,
      connection,
      userId: context.userId,
      siteUrl: data.siteUrl,
      branch: data.branch,
    });
  });

export const removeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, sourceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { source } = await loadSource(context, data.workspaceId, data.sourceId);
    const { removeSource: remove } = await import("@/server/connectors/github/service.server");
    await remove(source, context.userId);
    return { ok: true };
  });

export const inspectSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid, sourceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<SourceView> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { source, connection } = await loadSource(context, data.workspaceId, data.sourceId);
    const { inspectSource: inspect } = await import("@/server/connectors/github/service.server");
    return inspect({ source, connection, userId: context.userId });
  });

/* ------------------------------------------------------------------ */
/* AI Visibility boundary                                             */
/* ------------------------------------------------------------------ */

export const getSiteSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, host: z.string().min(1).max(255) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { getSiteSourceContext } = await import("@/server/connectors/source-context.server");
    return getSiteSourceContext(context.supabase, data.workspaceId, data.host);
  });
