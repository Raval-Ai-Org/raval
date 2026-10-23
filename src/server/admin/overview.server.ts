// Platform numbers for the Overview page. Every figure comes from a stored row
// (admin_overview); anything without a source is not shown at all.
import "server-only";
import type { AdminOverview } from "@/lib/admin/types";
import { adminRpc } from "./db.server";
import { getOverviewActivity } from "./activity.server";
import { getFundingOverview } from "./funding.server";

type Raw = {
  generated_at: string;
  users: Record<string, number>;
  workspaces: Record<string, number>;
  billing: Record<string, number>;
  jobs: Record<string, number>;
  admins: Record<string, number>;
};

const n = (value: unknown) => Number(value ?? 0);

export async function getOverview(pii = false): Promise<AdminOverview> {
  const [raw, funding, activity] = await Promise.all([
    adminRpc<Raw>("admin_overview", {}, "The overview is unavailable."),
    getFundingOverview(pii),
    getOverviewActivity(pii),
  ]);
  return {
    generatedAt: raw.generated_at,
    users: {
      total: n(raw.users.total),
      new7d: n(raw.users.new_7d),
      new30d: n(raw.users.new_30d),
      active7d: n(raw.users.active_7d),
      suspended: n(raw.users.suspended),
      unconfirmed: n(raw.users.unconfirmed),
    },
    workspaces: {
      total: n(raw.workspaces.total),
      new7d: n(raw.workspaces.new_7d),
      frozen: n(raw.workspaces.frozen),
    },
    billing: {
      payingAccounts: n(raw.billing.paying_accounts),
      trialingAccounts: n(raw.billing.trialing_accounts),
      pendingRequests: n(raw.billing.pending_requests),
    },
    jobs: {
      studioFailed24h: n(raw.jobs.studio_failed_24h),
      studioRunning: n(raw.jobs.studio_running),
    },
    admins: { active: n(raw.admins.active) },
    activity,
    funding,
  };
}
