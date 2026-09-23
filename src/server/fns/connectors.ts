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
  type ConnectionView,
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
      { diagnoseGitHub },
    ] = await Promise.all([
      import("@/server/connectors/present"),
      import("@/server/connectors/github/config.server"),
      import("@/server/connectors/github/api.server"),
    ]);
    const [connections, sources, diagnostic] = await Promise.all([
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
      diagnoseGitHub(),
    ]);
    if (connections.error) throw new Error(connections.error.message);
    if (sources.error) throw new Error(sources.error.message);
    const check = getGitHubConfigCheck();
    const issues = [...check.issues];
    if (check.ok && !diagnostic.githubApiReachable) {
      issues.push("GitHub App authentication failed — verify the App ID, slug and private key");
    }
    const oauthMode = check.ok && check.config.installVerification === "oauth";
    if (diagnostic.githubApiReachable && oauthMode && !diagnostic.oauthConfigurationValid) {
      issues.push("GITHUB_CLIENT_ID doesn't match the GitHub App's client ID");
    }
    const urlsValid =
      diagnostic.appUrlHttps && diagnostic.callbackUrlValid && diagnostic.webhookUrlValid;
    // Production needs its public HTTPS origin for callbacks and webhooks. A
    // development server is connectable: the production callback hands the
    // installer back to it (see installReturnOrigin).
    const production = process.env.NODE_ENV === "production";
    if (!urlsValid && production) {
      issues.push("APP_URL must be the deployed HTTPS origin for GitHub callbacks and webhooks");
    }
    return {
      providers: CONNECTOR_PROVIDERS,
      configured: {
        github: {
          ready:
            check.ok &&
            check.config.installVerification !== "unavailable" &&
            diagnostic.githubApiReachable &&
            (!oauthMode || diagnostic.oauthConfigurationValid) &&
            diagnostic.webhookSecretPresent &&
            (urlsValid || !production),
          installVerification: check.ok ? check.config.installVerification : "unavailable",
          // Variable names and rules only — never values.
          issues,
          diagnostic,
        },
        wordpress: {
          ready: Boolean(process.env.WORDPRESS_TOKEN_ENCRYPTION_KEY),
          installVerification: "application_password",
          issues: process.env.WORDPRESS_TOKEN_ENCRYPTION_KEY
            ? []
            : ["WORDPRESS_TOKEN_ENCRYPTION_KEY is not configured on this server"],
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
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        returnOrigin: z.string().max(200).optional(),
        returnPath: z.string().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { createInstallUrl } = await import("@/server/connectors/github/service.server");
    return createInstallUrl({
      workspaceId: data.workspaceId,
      userId: context.userId,
      returnOrigin: data.returnOrigin ?? null,
      returnPath: data.returnPath ?? null,
    });
  });

export type GithubConnectResult =
  | {
      status: "connected";
      workspaceId: string;
      returnPath: string | null;
      connections: ConnectionView[];
    }
  /** GitHub needs one more step (install the App, or authorize) — the page continues there. */
  | { status: "continue"; workspaceId: string; step: "install" | "authorize"; url: string };

export const completeGithubInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-complete")])
  .inputValidator((data) =>
    z
      .object({
        state: z.string().min(16).max(256),
        installationId: z
          .string()
          .regex(/^d{1,20}$/)
          .nullable()
          .optional(),
        setupAction: z.enum(["install", "update", "request"]).nullable().optional(),
        code: z.string().max(200).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<GithubConnectResult> => {
    const [svc, { CONNECTION_COLS, presentConnection }] = await Promise.all([
      import("@/server/connectors/github/service.server"),
      import("@/server/connectors/present"),
    ]);
    // The state binds the flow to the user who started it and to their workspace.
    // It is used up only once the connection is saved, so failures are retryable.
    const state = await svc.readInstallState(data.state, context.userId);
    await requireWorkspaceRole(context, state.workspaceId, "admin");
    const installationId = data.installationId ?? null;
    const code = data.code ?? null;

    let linked: ConnectionView[];
    if (state.consumedAt) {
      // A reload or double submit: show what this flow already saved.
      linked = installationId
        ? [await svc.findConnectionFromState(state, installationId)].filter(
            (c): c is ConnectionView => c !== null,
          )
        : await svc.findConnectionsFromState(state);
      if (!linked.length) {
        throw new svc.ConnectorError(
          "This connection link was already used. Start the connection again from Mellox.",
        );
      }
    } else if (installationId) {
      try {
        linked = [await svc.linkInstallation({ state, installationId, code })];
      } catch (e) {
        if (e instanceof svc.GitHubAuthorizationRequired) {
          return {
            status: "continue",
            workspaceId: state.workspaceId,
            step: "authorize",
            url: svc.githubAuthorizeUrl(data.state),
          };
        }
        throw e;
      }
      await svc.markInstallStateUsed(state);
    } else {
      if (!code) {
        throw new svc.ConnectorError(
          "GitHub didn't return an authorization. Start the connection again from Mellox.",
        );
      }
      linked = await svc.linkAuthorizedInstallations({ state, code });
      if (!linked.length) {
        return {
          status: "continue",
          workspaceId: state.workspaceId,
          step: "install",
          url: svc.githubInstallUrl(data.state),
        };
      }
      await svc.markInstallStateUsed(state);
    }

    // Report "connected" only when the signed-in user can read the saved rows
    // through their own RLS client — never on the service role's word alone.
    const { data: visible, error } = await context.supabase
      .from("workspace_connections")
      .select(CONNECTION_COLS)
      .eq("workspace_id", state.workspaceId)
      .in(
        "id",
        linked.map((c) => c.id),
      );
    if (error) throw new Error(error.message);
    if ((visible ?? []).length !== linked.length) {
      throw new svc.ConnectorError(
        "GitHub was connected, but your account can't see the saved connection in this workspace. Refresh Settings → Connections, or ask a workspace owner to check your role.",
        409,
      );
    }
    return {
      status: "connected",
      workspaceId: state.workspaceId,
      returnPath: state.returnPath,
      connections: (visible ?? []).map((r) => presentConnection(r as never)),
    };
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
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
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
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
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
/* Ownership: does this repository build the website?                 */
/* ------------------------------------------------------------------ */

export const verifySourceOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        sourceId: uuid,
        siteHost: z.string().min(3).max(255).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<SourceView> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { source, connection } = await loadSource(context, data.workspaceId, data.sourceId);
    const { verifySourceOwnership: verify } =
      await import("@/server/connectors/github/ownership.server");
    return verify({ source, connection, userId: context.userId, siteHost: data.siteHost });
  });

export const attestSourceOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        sourceId: uuid,
        siteHost: z.string().min(3).max(255),
        // The admin ticked the statement in the UI; the server records who and when.
        confirm: z.literal(true),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<SourceView> => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { source } = await loadSource(context, data.workspaceId, data.sourceId);
    const { attestSourceOwnership: attest } =
      await import("@/server/connectors/github/ownership.server");
    return attest({ source, userId: context.userId, siteHost: data.siteHost });
  });

export const setAgentConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, sourceId: uuid, consent: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<SourceView> => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { source } = await loadSource(context, data.workspaceId, data.sourceId);
    const { setAgentConsent: set } = await import("@/server/connectors/github/service.server");
    return set({ source, userId: context.userId, consent: data.consent });
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
    if (!(await getWorkspaceRole(context, data.workspaceId))) throw new ForbiddenError();
    const { getSiteSourceContext } = await import("@/server/connectors/source-context.server");
    return getSiteSourceContext(context.supabase, data.workspaceId, data.host);
  });
