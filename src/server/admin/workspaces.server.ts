// Workspaces (one brand = one workspace), as the admin console sees them.
// Reads only; suspension and read-only mode are set in access-control.server.ts.
import "server-only";
import type {
  AdminBillingSummary,
  AdminWorkspaceDetail,
  AdminWorkspaceRow,
  Paged,
} from "@/lib/admin/types";
import { HttpError } from "@/server/http-error";
import { auditForTarget, showEmail } from "./audit-read.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

type DirectoryRow = {
  id: string;
  name: string;
  domain: string | null;
  plan: string | null;
  created_at: string;
  frozen_at: string | null;
  frozen_reason: string | null;
  owner_id: string;
  owner_email: string | null;
  billing_plan: string | null;
  billing_status: string | null;
  member_count: number | string;
};

function mapWorkspace(row: DirectoryRow, pii: boolean): AdminWorkspaceRow {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    plan: row.plan,
    billingPlan: row.billing_plan,
    billingStatus: row.billing_status,
    ownerId: row.owner_id,
    ownerEmail: showEmail(row.owner_email, pii),
    memberCount: Number(row.member_count ?? 0),
    createdAt: row.created_at,
    frozen: Boolean(row.frozen_at),
    frozenReason: row.frozen_reason,
  };
}

export type WorkspaceListQuery = {
  search?: string;
  filter: "all" | "frozen" | "paid" | "free" | "recent";
  page: number;
  pageSize: number;
};

export async function listWorkspaces(
  query: WorkspaceListQuery,
  pii: boolean,
): Promise<Paged<AdminWorkspaceRow>> {
  const result = await adminRpc<{ total: number; rows: DirectoryRow[] }>(
    "admin_workspace_directory",
    {
      p_search: query.search ?? "",
      p_filter: query.filter,
      p_limit: query.pageSize,
      p_offset: (query.page - 1) * query.pageSize,
    },
  );
  return {
    total: Number(result.total ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    rows: (result.rows ?? []).map((row) => mapWorkspace(row, pii)),
  };
}

export async function getWorkspaceDetail(
  id: string,
  pii: boolean,
  includeAudit: boolean,
): Promise<AdminWorkspaceDetail> {
  const directory = await adminRpc<{ total: number; rows: DirectoryRow[] }>(
    "admin_workspace_directory",
    { p_search: id, p_filter: "all", p_limit: 1, p_offset: 0 },
  );
  const row = directory.rows?.[0];
  if (!row || row.id.toLowerCase() !== id.toLowerCase()) {
    throw new HttpError(404, "Workspace not found.");
  }

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [extra, members, billingRow, jobs, audit, accessRow] = await Promise.all([
    adminDb
      .from("workspaces")
      .select("industry, website_url, onboarded_at, billing_account_id")
      .eq("id", id)
      .maybeSingle(),
    adminRpc<Array<{ user_id: string; email: string | null; role: string; joined_at: string }>>(
      "admin_workspace_members",
      { p_workspace: id },
    ),
    adminDb
      .from("workspaces")
      .select(
        "billing_accounts:billing_account_id (id, plan_id, status, trial_ends_at, current_period_end, comped_plan_id, comped_until)",
      )
      .eq("id", id)
      .maybeSingle(),
    adminDb
      .from("studio_jobs")
      .select("status")
      .eq("workspace_id", id)
      .gte("created_at", since)
      .limit(2000),
    includeAudit ? auditForTarget("workspace", id, pii) : Promise.resolve([]),
    adminDb
      .from("workspace_access_state")
      .select("mode,reason,changed_at")
      .eq("workspace_id", id)
      .maybeSingle(),
  ]);
  if (accessRow.error) throw httpErrorFromPg(accessRow.error, "Could not load access state.");
  if (extra.error) throw httpErrorFromPg(extra.error, "Could not load the workspace.");
  if (billingRow.error) throw httpErrorFromPg(billingRow.error, "Could not load billing.");
  if (jobs.error) throw httpErrorFromPg(jobs.error, "Could not load jobs.");

  type Account = {
    id: string;
    plan_id: string;
    status: string;
    trial_ends_at: string | null;
    current_period_end: string | null;
    comped_plan_id: string | null;
    comped_until: string | null;
  };
  const account = (billingRow.data as unknown as { billing_accounts: Account | null } | null)
    ?.billing_accounts;
  const billing: AdminBillingSummary | null = account
    ? {
        id: account.id,
        planId: account.plan_id,
        status: account.status,
        trialEndsAt: account.trial_ends_at,
        currentPeriodEnd: account.current_period_end,
        comped: Boolean(
          account.comped_plan_id &&
          account.comped_until &&
          new Date(account.comped_until) > new Date(),
        ),
      }
    : null;

  const studioJobs7d: Record<string, number> = {};
  for (const job of jobs.data ?? []) {
    const status = String((job as { status: string }).status);
    studioJobs7d[status] = (studioJobs7d[status] ?? 0) + 1;
  }

  return {
    workspace: {
      ...mapWorkspace(row, pii),
      industry: (extra.data?.industry as string | null) ?? null,
      websiteUrl: (extra.data?.website_url as string | null) ?? null,
      onboardedAt: (extra.data?.onboarded_at as string | null) ?? null,
    },
    members: (members ?? []).map((m) => ({
      userId: m.user_id,
      email: showEmail(m.email, pii),
      role: m.role,
      joinedAt: m.joined_at,
    })),
    billing,
    studioJobs7d,
    access: {
      mode: ((accessRow.data as { mode?: string } | null)?.mode ?? "active") as
        "active" | "read_only" | "suspended",
      reason: (accessRow.data as { reason?: string | null } | null)?.reason ?? null,
      changedAt: (accessRow.data as { changed_at?: string | null } | null)?.changed_at ?? null,
    },
    audit,
  };
}
