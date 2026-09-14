// service.server.ts — the GitHub connector: install, verify, repositories,
// sources, disconnect and read-only source inspection.
//
// Callers (src/server/fns/connectors.ts) authenticate the user, check their
// workspace role and load rows through the caller's RLS client first. This
// module then writes with the service role. It never returns tokens, never
// writes to a repository, and never reads file contents except package.json
// (to detect the framework).
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { normalizeUrl } from "@/lib/crawl/html";
import type { ConnectionView, RepositoryOption, SourceView } from "@/lib/connectors/types";
import {
  appRequest,
  exchangeOAuthCode,
  forgetInstallationToken,
  GitHubAccessError,
  installationRequest,
  userCanAccessInstallation,
} from "./api.server";
import { HttpError } from "@/server/http-error";
import { requireGitHubConfig, GitHubNotConfiguredError } from "./config.server";
import { buildInspection } from "./inspect";
import {
  CONNECTION_COLS,
  presentConnection,
  presentSource,
  SOURCE_COLS,
  type ConnectionRow,
  type SourceRow,
} from "../present";

const STATE_TTL_MS = 20 * 60_000;
/** install_window verification: the installation must have changed this recently. */
const INSTALL_WINDOW_MS = 30 * 60_000;
const MAX_REPOSITORY_PAGES = 5;

export class ConnectorError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
    this.name = "ConnectorError";
  }
}

const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

type GitHubInstallation = {
  id: number;
  account: { login: string; type: string; avatar_url: string | null } | null;
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  html_url: string;
  created_at: string;
  updated_at: string;
  suspended_at: string | null;
};

type GitHubRepository = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  pushed_at: string | null;
  archived: boolean;
};

async function audit(
  workspaceId: string,
  userId: string | null,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    workspace_id: workspaceId,
    user_id: userId,
    action,
    entity: "connector",
    payload: payload as Json,
  });
  if (error) console.error("[connectors] audit not recorded", action, error.message);
}

/* ───────────────────────── Install ───────────────────────── */

export async function createInstallUrl(args: { workspaceId: string; userId: string }): Promise<{
  url: string;
  expiresInSeconds: number;
}> {
  const config = requireGitHubConfig();
  if (config.installVerification === "unavailable") {
    throw new GitHubNotConfiguredError([
      "GitHub installs can't be verified: set GITHUB_CLIENT_SECRET and enable OAuth during installation.",
    ]);
  }
  const state = randomBytes(32).toString("base64url");
  const now = Date.now();
  await supabaseAdmin
    .from("connector_install_states")
    .delete()
    .lt("expires_at", new Date(now - 24 * 3600_000).toISOString());
  const { error } = await supabaseAdmin.from("connector_install_states").insert({
    state_hash: hashState(state),
    workspace_id: args.workspaceId,
    user_id: args.userId,
    provider: "github",
    expires_at: new Date(now + STATE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`Couldn't start the GitHub connection: ${error.message}`);
  await audit(args.workspaceId, args.userId, "connector.github.install_started", {});
  const url = new URL(
    `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new`,
  );
  url.searchParams.set("state", state);
  return { url: url.toString(), expiresInSeconds: STATE_TTL_MS / 1000 };
}

export type InstallState = { workspaceId: string; userId: string; createdAt: string };

/** Claim a state exactly once. Throws a user-facing error for unknown, expired, used or foreign state. */
export async function consumeInstallState(state: string, userId: string): Promise<InstallState> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
    throw new ConnectorError(
      "This connection link is invalid. Start the connection again from Mellox.",
    );
  }
  const { data: row, error } = await supabaseAdmin
    .from("connector_install_states")
    .select("id, workspace_id, user_id, expires_at, consumed_at, created_at")
    .eq("state_hash", hashState(state))
    .eq("provider", "github")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row)
    throw new ConnectorError(
      "This connection link has expired. Start the connection again from Mellox.",
    );
  if (row.user_id !== userId) {
    throw new ConnectorError(
      "This connection was started by a different Mellox user. Sign in as that user or start again.",
    );
  }
  if (row.consumed_at) throw new ConnectorError("This connection link was already used.");
  if (Date.parse(row.expires_at) < Date.now()) {
    throw new ConnectorError(
      "This connection link has expired. Start the connection again from Mellox.",
    );
  }
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed?.length) throw new ConnectorError("This connection link was already used.");
  return { workspaceId: row.workspace_id, userId: row.user_id, createdAt: row.created_at };
}

/**
 * Link a GitHub installation to the workspace named by a consumed state, after
 * proving the returning user controls it:
 *   oauth          GitHub confirms (via the user's OAuth token) that this user
 *                  can access the installation
 *   install_window the installation was created/changed after this state was
 *                  issued, and isn't already linked to another workspace
 */
export async function linkInstallation(args: {
  state: InstallState;
  installationId: string;
  code: string | null;
}): Promise<ConnectionView> {
  const config = requireGitHubConfig();
  if (!/^\d{1,20}$/.test(args.installationId))
    throw new ConnectorError("GitHub returned an invalid installation.");

  const installation = await appRequest<GitHubInstallation>(
    `/app/installations/${args.installationId}`,
  );
  if (!installation?.account) {
    throw new ConnectorError(
      "That GitHub installation doesn't exist or was removed. Install the app again.",
    );
  }
  if (installation.suspended_at) {
    throw new ConnectorError(
      "This GitHub installation is suspended. Unsuspend it on GitHub, then reconnect.",
    );
  }

  let verification: "oauth" | "install_window";
  if (config.installVerification === "oauth") {
    if (!args.code) {
      throw new ConnectorError(
        "GitHub didn't send an authorization code. Enable “Request user authorization (OAuth) during installation” on the GitHub App.",
      );
    }
    const userToken = await exchangeOAuthCode(args.code);
    if (!(await userCanAccessInstallation(userToken, args.installationId))) {
      throw new ConnectorError("Your GitHub account can't access that installation.");
    }
    verification = "oauth";
  } else if (config.installVerification === "install_window") {
    const changedAt = Math.max(
      Date.parse(installation.created_at),
      Date.parse(installation.updated_at),
    );
    const issuedAt = Date.parse(args.state.createdAt);
    if (!(changedAt >= issuedAt - 60_000 && Date.now() - changedAt <= INSTALL_WINDOW_MS)) {
      throw new ConnectorError(
        "Mellox couldn't confirm this installation was just made from your session. Install or reconfigure the app from Mellox again.",
      );
    }
    const { data: elsewhere } = await supabaseAdmin
      .from("workspace_connections")
      .select("id")
      .eq("provider", "github")
      .eq("external_account_id", args.installationId)
      .neq("workspace_id", args.state.workspaceId)
      .neq("status", "revoked")
      .limit(1);
    if (elsewhere?.length) {
      throw new ConnectorError(
        "This GitHub installation is already connected to another workspace. Connecting it to more than one workspace requires GitHub OAuth verification.",
      );
    }
    verification = "install_window";
  } else {
    throw new GitHubNotConfiguredError(["GitHub installs can't be verified on this server."]);
  }

  const now = new Date().toISOString();
  const { data: row, error } = await supabaseAdmin
    .from("workspace_connections")
    .upsert(
      {
        workspace_id: args.state.workspaceId,
        provider: "github",
        external_account_id: args.installationId,
        status: "active",
        account_login: installation.account.login,
        account_type: installation.account.type,
        account_avatar_url: installation.account.avatar_url,
        manage_url: installation.html_url,
        repository_selection: installation.repository_selection,
        permissions: installation.permissions,
        verification,
        connected_by: args.state.userId,
        last_verified_at: now,
        last_error: null,
        revoked_at: null,
        revoked_reason: null,
      },
      { onConflict: "workspace_id,provider,external_account_id" },
    )
    .select(CONNECTION_COLS)
    .single();
  if (error || !row) throw new Error(error?.message ?? "Couldn't save the GitHub connection");

  // A reconnect restores sources that are still reachable.
  await syncSourceAccess(row as ConnectionRow);
  await audit(args.state.workspaceId, args.state.userId, "connector.github.connected", {
    connectionId: row.id,
    installationId: args.installationId,
    account: installation.account.login,
    repositorySelection: installation.repository_selection,
    verification,
  });
  return presentConnection(row as ConnectionRow);
}

/* ───────────────────────── Access health ───────────────────────── */

async function markAccessProblem(
  connection: ConnectionRow,
  error: GitHubAccessError,
  userId: string | null,
) {
  const status =
    error.reason === "suspended" ? "suspended" : error.reason === "revoked" ? "revoked" : "error";
  forgetInstallationToken(connection.external_account_id);
  await supabaseAdmin
    .from("workspace_connections")
    .update({
      status,
      last_error: error.message.slice(0, 500),
      ...(status === "revoked"
        ? { revoked_at: new Date().toISOString(), revoked_reason: "access_lost" }
        : {}),
    })
    .eq("id", connection.id);
  if (status === "revoked") {
    await supabaseAdmin
      .from("workspace_sources")
      .update({ status: "access_lost" })
      .eq("connection_id", connection.id);
  }
  await audit(connection.workspace_id, userId, "connector.github.access_problem", {
    connectionId: connection.id,
    reason: error.reason,
  });
}

/** Run a GitHub call for a connection; access failures update its status before rethrowing. */
async function withAccess<T>(
  connection: ConnectionRow,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (connection.status === "revoked") {
    throw new ConnectorError(
      "This GitHub connection was disconnected. Reconnect GitHub to continue.",
    );
  }
  if (connection.status === "suspended") {
    throw new ConnectorError(
      "This GitHub installation is suspended. Unsuspend it on GitHub, then verify the connection.",
    );
  }
  try {
    return await fn();
  } catch (error) {
    if (error instanceof GitHubAccessError) await markAccessProblem(connection, error, userId);
    throw error;
  }
}

async function listInstallationRepositories(
  installationId: string,
): Promise<{ repositories: GitHubRepository[]; total: number; truncated: boolean }> {
  const repositories: GitHubRepository[] = [];
  let total = 0;
  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page++) {
    const json = await installationRequest<{
      total_count: number;
      repositories: GitHubRepository[];
    }>(installationId, `/installation/repositories?per_page=100&page=${page}`, {
      notFoundIsAccessError: true,
    });
    total = json?.total_count ?? 0;
    repositories.push(...(json?.repositories ?? []));
    if (!json || json.repositories.length < 100) break;
  }
  return { repositories, total, truncated: total > repositories.length };
}

/** Mark sources active/access_lost from the installation's current repository list. */
async function syncSourceAccess(connection: ConnectionRow): Promise<void> {
  const { data: sources } = await supabaseAdmin
    .from("workspace_sources")
    .select("id, external_id, status")
    .eq("connection_id", connection.id);
  if (!sources?.length) return;
  const { repositories, truncated } = await listInstallationRepositories(
    connection.external_account_id,
  );
  if (truncated && connection.repository_selection === "all") {
    // Can't prove absence from a partial list of an all-repositories install.
    await supabaseAdmin
      .from("workspace_sources")
      .update({ status: "active" })
      .eq("connection_id", connection.id);
    return;
  }
  const reachable = new Set(repositories.map((r) => String(r.id)));
  for (const source of sources) {
    const status = reachable.has(source.external_id) ? "active" : "access_lost";
    if (status !== source.status) {
      await supabaseAdmin.from("workspace_sources").update({ status }).eq("id", source.id);
    }
  }
}

export async function verifyConnection(
  connection: ConnectionRow,
  userId: string | null,
): Promise<ConnectionView> {
  const installation = await appRequest<GitHubInstallation>(
    `/app/installations/${connection.external_account_id}`,
  );
  const now = new Date().toISOString();
  if (!installation) {
    await markAccessProblem(
      connection,
      new GitHubAccessError("revoked", "The GitHub App was uninstalled from this account."),
      userId,
    );
  } else if (installation.suspended_at) {
    await markAccessProblem(
      connection,
      new GitHubAccessError("suspended", "This GitHub installation is suspended."),
      userId,
    );
  } else if (connection.status === "revoked") {
    throw new ConnectorError("This connection was disconnected. Use Reconnect to link it again.");
  } else {
    await supabaseAdmin
      .from("workspace_connections")
      .update({
        status: "active",
        account_login: installation.account?.login ?? connection.account_login,
        account_avatar_url: installation.account?.avatar_url ?? connection.account_avatar_url,
        repository_selection: installation.repository_selection,
        permissions: installation.permissions,
        manage_url: installation.html_url,
        last_verified_at: now,
        last_error: null,
      })
      .eq("id", connection.id);
    await syncSourceAccess({
      ...connection,
      repository_selection: installation.repository_selection,
    });
  }
  const { data: row } = await supabaseAdmin
    .from("workspace_connections")
    .select(CONNECTION_COLS)
    .eq("id", connection.id)
    .single();
  return presentConnection(row as ConnectionRow);
}

export async function disconnectConnection(
  connection: ConnectionRow,
  userId: string,
): Promise<void> {
  forgetInstallationToken(connection.external_account_id);
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("workspace_connections")
    .update({
      status: "revoked",
      revoked_at: now,
      revoked_reason: "disconnected_in_mellox",
      last_error: null,
    })
    .eq("id", connection.id);
  await supabaseAdmin
    .from("workspace_sources")
    .update({ status: "access_lost" })
    .eq("connection_id", connection.id);
  await audit(connection.workspace_id, userId, "connector.github.disconnected", {
    connectionId: connection.id,
    installationId: connection.external_account_id,
    account: connection.account_login,
  });
}

/* ───────────────────────── Repositories & sources ───────────────────────── */

function toOption(r: GitHubRepository): RepositoryOption {
  return {
    id: String(r.id),
    name: r.name,
    fullName: r.full_name,
    ownerLogin: r.owner.login,
    private: r.private,
    defaultBranch: r.default_branch,
    htmlUrl: r.html_url,
    description: r.description ? r.description.slice(0, 200) : null,
    homepage: r.homepage && /^https?:\/\//i.test(r.homepage) ? r.homepage.slice(0, 300) : null,
    pushedAt: r.pushed_at,
    archived: r.archived,
  };
}

export async function listRepositories(
  connection: ConnectionRow,
  userId: string,
  query?: string,
): Promise<{ repositories: RepositoryOption[]; total: number; truncated: boolean }> {
  return withAccess(connection, userId, async () => {
    const { repositories, total, truncated } = await listInstallationRepositories(
      connection.external_account_id,
    );
    const q = (query ?? "").trim().toLowerCase();
    const options = repositories
      .filter(
        (r) =>
          !q ||
          r.full_name.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q),
      )
      .map(toOption)
      .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
    await supabaseAdmin
      .from("workspace_connections")
      .update({ last_verified_at: new Date().toISOString(), last_error: null, status: "active" })
      .eq("id", connection.id);
    return { repositories: options, total, truncated };
  });
}

function normalizeSiteUrl(raw: string | null | undefined): { url: string; host: string } | null {
  if (!raw || !raw.trim()) return null;
  try {
    const u = new URL(normalizeUrl(raw.trim()));
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad scheme");
    return { url: u.origin, host: u.hostname.toLowerCase().replace(/^www\./, "") };
  } catch {
    throw new ConnectorError("Enter the website as a domain or http(s) URL, e.g. example.com.");
  }
}

export async function selectRepository(args: {
  connection: ConnectionRow;
  userId: string;
  repositoryId: string;
  siteUrl?: string | null;
}): Promise<SourceView> {
  const { connection } = args;
  if (!/^\d{1,20}$/.test(args.repositoryId)) throw new ConnectorError("Invalid repository.");
  return withAccess(connection, args.userId, async () => {
    // Fetching through the installation token proves the installation can read this repository.
    const repo = await installationRequest<GitHubRepository>(
      connection.external_account_id,
      `/repositories/${args.repositoryId}`,
      { notFoundIsAccessError: true },
    );
    if (!repo) throw new ConnectorError("Mellox can't access that repository.");
    const site = normalizeSiteUrl(args.siteUrl ?? repo.homepage);
    const { data: row, error } = await supabaseAdmin
      .from("workspace_sources")
      .upsert(
        {
          workspace_id: connection.workspace_id,
          connection_id: connection.id,
          provider: "github",
          kind: "repository",
          external_id: String(repo.id),
          name: repo.name,
          full_name: repo.full_name,
          owner_login: repo.owner.login,
          private: repo.private,
          default_branch: repo.default_branch,
          branch: repo.default_branch,
          html_url: repo.html_url,
          site_url: site?.url ?? null,
          site_host: site?.host ?? null,
          status: "active",
          last_synced_at: new Date().toISOString(),
          last_error: null,
          selected_by: args.userId,
        },
        { onConflict: "workspace_id,provider,external_id" },
      )
      .select(SOURCE_COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Couldn't save the repository");
    await audit(connection.workspace_id, args.userId, "connector.github.repository_selected", {
      connectionId: connection.id,
      repository: repo.full_name,
      private: repo.private,
    });
    return presentSource(row as SourceRow);
  });
}

export async function updateSource(args: {
  source: SourceRow;
  connection: ConnectionRow;
  userId: string;
  siteUrl?: string | null;
  branch?: string | null;
}): Promise<SourceView> {
  const patch: {
    site_url?: string | null;
    site_host?: string | null;
    branch?: string;
    inspection?: null;
  } = {};
  if (args.siteUrl !== undefined) {
    const site = normalizeSiteUrl(args.siteUrl);
    patch.site_url = site?.url ?? null;
    patch.site_host = site?.host ?? null;
  }
  if (args.branch !== undefined && args.branch !== args.source.branch) {
    const branch = (args.branch ?? "").trim() || args.source.default_branch;
    if (!branch || !/^[\w./-]{1,200}$/.test(branch) || branch.includes("..")) {
      throw new ConnectorError("That branch name isn't valid.");
    }
    await withAccess(args.connection, args.userId, async () => {
      const found = await installationRequest(
        args.connection.external_account_id,
        `/repos/${args.source.full_name}/branches/${encodeURIComponent(branch)}`,
      );
      if (!found)
        throw new ConnectorError(`Branch “${branch}” doesn't exist in ${args.source.full_name}.`);
    });
    patch.branch = branch;
    patch.inspection = null;
  }
  if (!Object.keys(patch).length) return presentSource(args.source);
  const { data: row, error } = await supabaseAdmin
    .from("workspace_sources")
    .update(patch)
    .eq("id", args.source.id)
    .select(SOURCE_COLS)
    .single();
  if (error || !row) throw new Error(error?.message ?? "Couldn't update the source");
  await audit(args.source.workspace_id, args.userId, "connector.github.source_updated", {
    sourceId: args.source.id,
    fields: Object.keys(patch),
  });
  return presentSource(row as SourceRow);
}

export async function removeSource(source: SourceRow, userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("workspace_sources").delete().eq("id", source.id);
  if (error) throw new Error(error.message);
  await audit(source.workspace_id, userId, "connector.github.repository_removed", {
    sourceId: source.id,
    repository: source.full_name,
  });
}

/* ───────────────────────── Source inspection (read-only) ───────────────────────── */

const MAX_PACKAGE_JSON_BYTES = 256_000;

export async function inspectSource(args: {
  source: SourceRow;
  connection: ConnectionRow;
  userId: string;
}): Promise<SourceView> {
  const { source, connection } = args;
  if (source.status === "access_lost") {
    throw new ConnectorError(
      "Mellox lost access to this repository. Verify the GitHub connection or re-grant access on GitHub.",
    );
  }
  const installationId = connection.external_account_id;
  const branch = source.branch ?? source.default_branch ?? "main";
  try {
    const inspection = await withAccess(connection, args.userId, async () => {
      const branchInfo = await installationRequest<{
        commit: { sha: string; commit: { tree: { sha: string } } };
      }>(installationId, `/repos/${source.full_name}/branches/${encodeURIComponent(branch)}`);
      if (!branchInfo) throw new ConnectorError(`Branch “${branch}” no longer exists.`);
      const tree = await installationRequest<{
        tree: { path: string; type: string }[];
        truncated: boolean;
      }>(
        installationId,
        `/repos/${source.full_name}/git/trees/${branchInfo.commit.commit.tree.sha}?recursive=1`,
      );
      const entries = (tree?.tree ?? []).slice(0, 60_000);
      const paths = entries.filter((e) => e.type === "blob").map((e) => e.path);
      const rootEntries = entries.filter((e) => !e.path.includes("/")).map((e) => e.path);

      let pkg = null;
      if (rootEntries.includes("package.json")) {
        const file = await installationRequest<{
          content?: string;
          encoding?: string;
          size?: number;
        }>(
          installationId,
          `/repos/${source.full_name}/contents/package.json?ref=${encodeURIComponent(branch)}`,
        );
        if (
          file?.content &&
          file.encoding === "base64" &&
          (file.size ?? 0) <= MAX_PACKAGE_JSON_BYTES
        ) {
          try {
            pkg = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
          } catch {
            pkg = null;
          }
        }
      }
      return buildInspection({
        branch,
        commitSha: branchInfo.commit.sha,
        rootEntries,
        paths,
        truncated: Boolean(tree?.truncated),
        pkg,
        now: new Date(),
      });
    });
    const { data: row, error } = await supabaseAdmin
      .from("workspace_sources")
      .update({
        inspection: inspection as unknown as Json,
        last_synced_at: inspection.inspectedAt,
        last_error: null,
      })
      .eq("id", source.id)
      .select(SOURCE_COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Couldn't save the inspection");
    await audit(source.workspace_id, args.userId, "connector.github.source_inspected", {
      sourceId: source.id,
      repository: source.full_name,
      branch,
      framework: inspection.framework,
    });
    return presentSource(row as SourceRow);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inspection failed";
    await supabaseAdmin
      .from("workspace_sources")
      .update({ last_error: message.slice(0, 500) })
      .eq("id", source.id);
    throw error;
  }
}
