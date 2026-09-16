// service.server.ts — the one place workspaces are created, listed and deleted.
//
// Projects, Agency HQ and the workspace switcher all go through these; no page
// implements its own workspace lookup, fallback or delete.
//   - create: race-proof and idempotent in the database
//     (private.create_workspace_for_user — per-user advisory lock, idempotency
//     key, one unflagged workspace per owner + normalized domain)
//   - list:   public.workspace_overview() under the CALLER's RLS, so every
//     metric is correlated on its own workspace id
//   - delete: owner only, typed confirmation, storage + provider cleanup,
//     recorded in workspace_deletions (audit_logs cascade with the workspace)
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeDomain } from "@/lib/workspace/domain";
import { HttpError } from "@/server/http-error";

export const DELETE_CONFIRMATION = "CONFIRM";
const STORAGE_BUCKET = "generated-assets";

// Generated types lag new RPCs/tables until `npm run db:types` runs against the
// migrated project; the shapes used here are declared locally.
const admin = supabaseAdmin as unknown as SupabaseClient;

export type CreateWorkspaceResult = {
  id: string;
  /** false → an existing workspace was returned (same brand domain or replayed request). */
  created: boolean;
  domain: string | null;
  name: string;
};

export async function createOrGetWorkspace(args: {
  userId: string;
  name: string;
  websiteUrl: string | null;
  idempotencyKey: string | null;
}): Promise<CreateWorkspaceResult> {
  const { data, error } = await admin.rpc("create_workspace_for_user", {
    p_user_id: args.userId,
    p_name: args.name,
    p_website_url: args.websiteUrl,
    p_idempotency_key: args.idempotencyKey ? `${args.userId}:${args.idempotencyKey}` : null,
  });
  if (error) {
    console.error("[workspaces] create failed", error.code, error.message);
    throw new HttpError(500, "Could not create workspace");
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    { workspace_id: string; created: boolean } | undefined;
  if (!row?.workspace_id) throw new HttpError(500, "Could not create workspace");

  const { data: ws } = await admin
    .from("workspaces")
    .select("name, domain")
    .eq("id", row.workspace_id)
    .maybeSingle();
  return {
    id: row.workspace_id,
    created: row.created,
    domain: (ws?.domain as string | null) ?? normalizeDomain(args.websiteUrl),
    name: (ws?.name as string | undefined) ?? args.name,
  };
}

export type WorkspaceHealth = "healthy" | "attention" | "setup";

export type WorkspaceSummary = {
  id: string;
  name: string;
  websiteUrl: string | null;
  domain: string | null;
  industry: string | null;
  clientStatus: "active" | "onboarding" | "paused";
  plan: string;
  role: "owner" | "admin" | "editor" | "viewer";
  isOwner: boolean;
  duplicateOf: string | null;
  onboarded: boolean;
  createdAt: string;
  logoUrl: string | null;
  pendingApprovals: number;
  draftCount: number;
  scheduledCount: number;
  publishedCount: number;
  failedCount: number;
  connectedSocialAccounts: number;
  geoScore: number | null;
  geoScannedAt: string | null;
  lastActivityAt: string;
  health: WorkspaceHealth;
};

type OverviewRow = {
  id: string;
  name: string;
  website_url: string | null;
  domain: string | null;
  industry: string | null;
  client_status: string | null;
  plan: string | null;
  role: string;
  owner_id: string;
  duplicate_of: string | null;
  onboarded_at: string | null;
  created_at: string;
  logo_url: string | null;
  pending_approvals: number | string;
  draft_count: number | string;
  scheduled_count: number | string;
  published_count: number | string;
  failed_count: number | string;
  connected_social_accounts: number | string;
  geo_score: number | null;
  geo_scanned_at: string | null;
  last_activity_at: string | null;
};

export function workspaceHealth(
  s: Pick<WorkspaceSummary, "onboarded" | "domain" | "failedCount" | "pendingApprovals">,
): WorkspaceHealth {
  if (!s.onboarded || !s.domain) return "setup";
  if (s.failedCount > 0 || s.pendingApprovals >= 10) return "attention";
  return "healthy";
}

export function presentOverviewRow(row: OverviewRow, userId: string): WorkspaceSummary {
  const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
  const status = row.client_status;
  const base = {
    id: row.id,
    name: row.name,
    websiteUrl: row.website_url,
    domain: row.domain,
    industry: row.industry,
    clientStatus: (status === "active" || status === "paused" ? status : "onboarding") as
      "active" | "onboarding" | "paused",
    plan: row.plan ?? "free",
    role: row.role as WorkspaceSummary["role"],
    isOwner: row.owner_id === userId,
    duplicateOf: row.duplicate_of,
    onboarded: Boolean(row.onboarded_at),
    createdAt: row.created_at,
    logoUrl: row.logo_url && /^https?:\/\//i.test(row.logo_url) ? row.logo_url : null,
    pendingApprovals: n(row.pending_approvals),
    draftCount: n(row.draft_count),
    scheduledCount: n(row.scheduled_count),
    publishedCount: n(row.published_count),
    failedCount: n(row.failed_count),
    connectedSocialAccounts: n(row.connected_social_accounts),
    geoScore: row.geo_score,
    geoScannedAt: row.geo_scanned_at,
    lastActivityAt: row.last_activity_at ?? row.created_at,
  };
  return { ...base, health: workspaceHealth(base) };
}

/** Every workspace the caller belongs to, with metrics — read under the caller's RLS. */
export async function listAuthorizedWorkspaces(
  userClient: SupabaseClient,
  userId: string,
): Promise<WorkspaceSummary[]> {
  const { data, error } = await userClient.rpc("workspace_overview");
  if (error) {
    console.error("[workspaces] overview failed", error.code, error.message);
    throw new HttpError(500, "Could not load workspaces");
  }
  const seen = new Set<string>();
  const out: WorkspaceSummary[] = [];
  for (const row of (data ?? []) as OverviewRow[]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(presentOverviewRow(row, userId));
  }
  return out;
}

export type DeleteWorkspaceResult = {
  id: string;
  name: string;
  storageObjectsRemoved: number;
};

/** All object paths under workspace/<id>/ in the generated-assets bucket. */
async function listWorkspaceObjects(workspaceId: string): Promise<string[]> {
  const paths: string[] = [];
  const walk = async (prefix: string, depth: number) => {
    if (depth > 6) return;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage
        .from(STORAGE_BUCKET)
        .list(prefix, { limit: 1000, offset });
      if (error || !data?.length) return;
      for (const entry of data) {
        const full = `${prefix}/${entry.name}`;
        // Folders come back without an id.
        if (entry.id) paths.push(full);
        else await walk(full, depth + 1);
      }
      if (data.length < 1000) return;
    }
  };
  await walk(`workspace/${workspaceId}`, 0);
  return paths;
}

export type DeleteDeps = {
  listObjects: (workspaceId: string) => Promise<string[]>;
  removeObjects: (paths: string[]) => Promise<void>;
  releaseSocialBrand: (brandId: string) => Promise<void>;
};

const defaultDeleteDeps: DeleteDeps = {
  listObjects: listWorkspaceObjects,
  removeObjects: async (paths) => {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from(STORAGE_BUCKET).remove(paths.slice(i, i + 100));
      if (error) console.error("[workspaces] storage cleanup failed", error.message);
    }
  },
  releaseSocialBrand: async (brandId) => {
    const { getSocialApiClient } = await import("@/lib/socialapi/workspace.server");
    const res = await getSocialApiClient()({
      method: "DELETE",
      path: `/brands/${encodeURIComponent(brandId)}`,
    });
    if (res.status >= 300 && res.status !== 404) {
      console.warn("[workspaces] provider brand not released", brandId, res.status);
    }
  },
};

/**
 * Permanently delete one workspace. The caller must be its owner and type
 * CONFIRM. Other workspaces and the user's account are untouched: every
 * workspace-owned table references workspaces(id) ON DELETE CASCADE.
 */
export async function deleteWorkspace(
  args: { workspaceId: string; userId: string; confirmation: string },
  deps: DeleteDeps = defaultDeleteDeps,
  db: SupabaseClient = admin,
): Promise<DeleteWorkspaceResult> {
  if (args.confirmation !== DELETE_CONFIRMATION) {
    throw new HttpError(400, `Type ${DELETE_CONFIRMATION} to delete this workspace`);
  }

  const { data: ws } = await db
    .from("workspaces")
    .select("id, name, domain, owner_id")
    .eq("id", args.workspaceId)
    .maybeSingle();
  if (!ws) throw new HttpError(404, "Workspace not found");

  const { data: membership } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (!membership) throw new HttpError(404, "Workspace not found");
  if (ws.owner_id !== args.userId || membership.role !== "owner") {
    throw new HttpError(403, "Only the workspace owner can delete it");
  }

  const { data: social } = await db
    .from("workspace_socialapi")
    .select("brand_id")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  const objects = await deps.listObjects(args.workspaceId).catch(() => [] as string[]);

  const { error: deleteError, data: deleted } = await db
    .from("workspaces")
    .delete()
    .eq("id", args.workspaceId)
    .eq("owner_id", args.userId)
    .select("id");
  if (deleteError || !deleted?.length) {
    console.error("[workspaces] delete failed", deleteError?.message);
    throw new HttpError(500, "Could not delete workspace");
  }

  // The rows are gone; external cleanup is best effort and never re-reported
  // as a failed delete.
  if (objects.length) await deps.removeObjects(objects).catch(() => undefined);
  const brandId = (social?.brand_id as string | null) ?? null;
  if (brandId) await deps.releaseSocialBrand(brandId).catch(() => undefined);

  await db.from("workspace_deletions").insert({
    workspace_id: args.workspaceId,
    workspace_name: ws.name,
    domain: ws.domain,
    owner_id: ws.owner_id,
    deleted_by: args.userId,
    storage_objects_removed: objects.length,
  });

  return { id: args.workspaceId, name: ws.name as string, storageObjectsRemoved: objects.length };
}
