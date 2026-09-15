// present.ts — connector rows → browser-safe views. Only whitelisted fields
// leave the server; there is nothing secret in these tables, but metadata
// columns are never passed through wholesale.
import "server-only";
import type {
  ConnectionStatus,
  ConnectionView,
  ConnectorProviderId,
  SourceInspection,
  SourceView,
} from "@/lib/connectors/types";
import type { OwnershipEvidence, OwnershipStatus } from "@/lib/connectors/ownership";

export const CONNECTION_COLS =
  "id, workspace_id, provider, status, external_account_id, account_login, account_type, account_avatar_url, manage_url, repository_selection, permissions, verification, last_verified_at, last_error, revoked_at, revoked_reason, created_at";

export const SOURCE_COLS =
  "id, workspace_id, connection_id, provider, external_id, name, full_name, owner_login, private, default_branch, branch, html_url, site_url, site_host, status, inspection, last_synced_at, last_error, created_at, ownership_status, ownership_confidence, ownership_site_host, ownership_commit_sha, ownership_evidence, ownership_hints, ownership_checked_at, agent_consent_at";

export type ConnectionRow = {
  id: string;
  workspace_id: string;
  provider: ConnectorProviderId;
  status: ConnectionStatus;
  external_account_id: string;
  account_login: string;
  account_type: string | null;
  account_avatar_url: string | null;
  manage_url: string | null;
  repository_selection: "all" | "selected" | null;
  permissions: Record<string, string> | null;
  verification: "oauth" | "install_window";
  last_verified_at: string | null;
  last_error: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
};

export type SourceRow = {
  id: string;
  workspace_id: string;
  connection_id: string;
  provider: ConnectorProviderId;
  external_id: string;
  name: string;
  full_name: string;
  owner_login: string | null;
  private: boolean;
  default_branch: string | null;
  branch: string | null;
  html_url: string | null;
  site_url: string | null;
  site_host: string | null;
  status: "active" | "access_lost";
  inspection: SourceInspection | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  ownership_status: OwnershipStatus;
  ownership_confidence: number | string | null;
  ownership_site_host: string | null;
  ownership_commit_sha: string | null;
  ownership_evidence: OwnershipEvidence[] | null;
  ownership_hints: string[] | null;
  ownership_checked_at: string | null;
  agent_consent_at: string | null;
};

const SAFE_URL = /^https:\/\/(github\.com|avatars\.githubusercontent\.com)\//;
const safeUrl = (u: string | null) => (u && SAFE_URL.test(u) ? u : null);

export function presentConnection(row: ConnectionRow): ConnectionView {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    accountLogin: row.account_login,
    accountType: row.account_type,
    accountAvatarUrl: safeUrl(row.account_avatar_url),
    manageUrl: safeUrl(row.manage_url),
    repositorySelection: row.repository_selection,
    permissions: row.permissions ?? {},
    verification: row.verification,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    connectedAt: row.created_at,
  };
}

export function presentSource(row: SourceRow): SourceView {
  return {
    id: row.id,
    connectionId: row.connection_id,
    provider: row.provider,
    status: row.status,
    externalId: row.external_id,
    name: row.name,
    fullName: row.full_name,
    private: row.private,
    defaultBranch: row.default_branch,
    branch: row.branch,
    htmlUrl: safeUrl(row.html_url),
    siteUrl: row.site_url,
    inspection: row.inspection,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    selectedAt: row.created_at,
    ownership: {
      status: row.ownership_status ?? "unchecked",
      confidence: row.ownership_confidence == null ? null : Number(row.ownership_confidence),
      siteHost: row.ownership_site_host ?? null,
      commitSha: row.ownership_commit_sha ?? null,
      evidence: (row.ownership_evidence ?? []).slice(0, 30).map((e) => ({
        signal: e.signal,
        weight: e.weight,
        polarity: e.polarity,
        detail: String(e.detail ?? "").slice(0, 300),
        ...(e.path ? { path: String(e.path).slice(0, 300) } : {}),
        ...(e.url && /^https?:\/\//i.test(e.url) ? { url: String(e.url).slice(0, 300) } : {}),
      })),
      hints: (row.ownership_hints ?? []).slice(0, 6).map((h) => String(h).slice(0, 300)),
      checkedAt: row.ownership_checked_at ?? null,
    },
    agentConsentAt: row.agent_consent_at ?? null,
  };
}
