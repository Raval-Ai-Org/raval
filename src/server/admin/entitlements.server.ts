// What a workspace may do, why, and the exceptions staff have set.
//
// Reads go through the real resolver (getEntitlements) so the console shows what
// the product enforces, never a second opinion. The read skips capacity
// reconciliation, which can freeze brands: looking must change nothing.
// Changes go through database functions that write their own audit row.
import "server-only";
import { FEATURES, PLANS, planAllows, type FeatureKey, type PlanId } from "@/lib/billing/catalog";
import {
  OVERRIDE_LIMIT_KEYS,
  isOverridableFeature,
  isOverrideLimitKey,
  type OverrideLimitKey,
} from "@/lib/billing/overrides";
import { isEntitlementOverridesEnabled } from "@/lib/feature-flags";
import type {
  AdminEntitlementView,
  AdminOverrideRow,
  AdminOverrideStatus,
} from "@/lib/admin/types";
import { getEntitlements, type Entitlements } from "@/server/billing/entitlements.server";
import { OVERRIDE_COLUMNS } from "@/server/billing/overrides.server";
import { HttpError } from "@/server/http-error";
import { emailsFor, showEmail } from "./audit-read.server";
import type { AuditContext } from "./audit.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

type WorkspaceRef = { id: string; name: string; owner_id: string; billing_account_id: string };

async function workspaceRef(workspaceId: string): Promise<WorkspaceRef> {
  const { data, error } = await adminDb
    .from("workspaces")
    .select("id,name,owner_id,billing_account_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw httpErrorFromPg(error, "Could not load the workspace.");
  if (!data) throw new HttpError(404, "Workspace not found.");
  return data as WorkspaceRef;
}

const USAGE_FOR: Partial<Record<OverrideLimitKey, keyof Entitlements["usage"]>> = {
  trackedPrompts: "trackedPrompts",
  competitors: "competitors",
  scansPerMonth: "scansUsed",
  maxConcurrentExperiments: "openExperiments",
  maxConcurrentRenders: "rendersRunning",
  postsFairUse: "postsThisMonth",
};

type OverrideDb = {
  id: string;
  account_id: string;
  workspace_id: string | null;
  kind: "feature" | "limit";
  key: string;
  allowed: boolean | null;
  limit_value: number | null;
  reason: string;
  starts_at: string;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
};

function statusOf(row: OverrideDb, now: number): AdminOverrideStatus {
  if (row.revoked_at) return "revoked";
  if (new Date(row.starts_at).getTime() > now) return "scheduled";
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return "expired";
  return "active";
}

export async function explainWorkspaceEntitlements(
  workspaceId: string,
  pii: boolean,
): Promise<AdminEntitlementView> {
  const workspace = await workspaceRef(workspaceId);
  const entitlements = await getEntitlements({
    userId: workspace.owner_id,
    workspaceId,
    role: "owner",
    skipCapacityReconcile: true,
  });
  const applied = new Map((entitlements.overrides ?? []).map((o) => [`${o.kind}:${o.key}`, o]));
  const paused = entitlements.status === "paused";

  const { data, error } = await adminDb
    .from("entitlement_overrides")
    .select(`${OVERRIDE_COLUMNS},reason,created_by,revoke_reason`)
    .eq("account_id", workspace.billing_account_id)
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    throw httpErrorFromPg(error, "Could not load overrides.");
  }
  const rows = (error ? [] : (data ?? [])) as unknown as OverrideDb[];
  const emails = await emailsFor([workspace.owner_id, ...rows.map((r) => r.created_by)]);
  const now = Date.now();

  const features = (Object.keys(FEATURES) as FeatureKey[]).map((key) => {
    const def = FEATURES[key];
    const hit = applied.get(`feature:${key}`);
    return {
      key,
      label: def.label,
      module: def.module,
      sold: (def.availability ?? "launch") === "launch",
      allowed: entitlements.features[key].allowed,
      planAllows: !paused && planAllows(entitlements.entitledPlan, key),
      requiredPlan: def.minPlan,
      source: hit ? ("override" as const) : ("plan" as const),
      ...(hit ? { overrideScope: hit.scope } : {}),
    };
  });

  const planLimits = PLANS[entitlements.entitledPlan as PlanId].limits;
  const limits = OVERRIDE_LIMIT_KEYS.map((key) => {
    const hit = applied.get(`limit:${key}`);
    const usageKey = USAGE_FOR[key];
    return {
      key,
      planValue: planLimits[key],
      effective: entitlements.limits[key],
      used: usageKey ? entitlements.usage[usageKey] : null,
      source: hit ? ("override" as const) : ("plan" as const),
      ...(hit ? { overrideScope: hit.scope } : {}),
    };
  });

  return {
    workspace: { id: workspace.id, name: workspace.name },
    account: {
      id: entitlements.accountId,
      plan: entitlements.plan,
      entitledPlan: entitlements.entitledPlan,
      status: entitlements.status,
      enforcement: entitlements.enforcement,
      ownerEmail: showEmail(emails.get(workspace.owner_id), pii),
      overridesEnabled: isEntitlementOverridesEnabled(),
    },
    features,
    limits,
    fixedLimits: [
      { key: "brands", effective: entitlements.limits.brands, used: entitlements.usage.brands },
      { key: "seats", effective: entitlements.limits.seats, used: entitlements.usage.seats },
    ],
    overrides: rows.map((row): AdminOverrideRow => ({
      id: row.id,
      scope: row.workspace_id ? "workspace" : "account",
      kind: row.kind,
      key: row.key,
      allowed: row.allowed,
      limitValue: row.limit_value,
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      status: statusOf(row, now),
      reason: row.reason,
      createdBy: showEmail(emails.get(row.created_by), pii),
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      revokeReason: row.revoke_reason,
    })),
  };
}

type Actor = { actorId: string; actorRole: string; audit: AuditContext };

export type CreateOverrideInput = {
  workspaceId: string;
  scope: "account" | "workspace";
  kind: "feature" | "limit";
  key: string;
  allowed?: boolean;
  limitValue?: number;
  startsAt?: string;
  expiresAt?: string;
  reason: string;
};

export async function createOverride(actor: Actor, input: CreateOverrideInput) {
  if (input.kind === "feature") {
    if (!isOverridableFeature(input.key))
      throw new HttpError(400, "That feature can't be overridden.");
    if (typeof input.allowed !== "boolean") throw new HttpError(400, "Choose allow or deny.");
  } else {
    if (!isOverrideLimitKey(input.key)) throw new HttpError(400, "That limit can't be overridden.");
    if (!Number.isInteger(input.limitValue) || (input.limitValue as number) < 0) {
      throw new HttpError(400, "Enter a whole number, zero or more.");
    }
  }
  // The account comes from the workspace, never from the browser.
  const workspace = await workspaceRef(input.workspaceId);
  return adminRpc<{ id: string }>(
    "admin_override_create",
    {
      p_actor: actor.actorId,
      p_actor_role: actor.actorRole,
      p_account: workspace.billing_account_id,
      p_workspace: input.scope === "workspace" ? workspace.id : null,
      p_kind: input.kind,
      p_key: input.key,
      p_allowed: input.kind === "feature" ? input.allowed : null,
      p_limit_value: input.kind === "limit" ? input.limitValue : null,
      p_starts_at: input.startsAt ?? null,
      p_expires_at: input.expiresAt ?? null,
      p_reason: input.reason,
      p_request_id: actor.audit.requestId,
      p_ip: actor.audit.ip,
      p_user_agent: actor.audit.userAgent,
    },
    "Could not save the override.",
  );
}

export async function revokeOverride(actor: Actor, id: string, reason: string) {
  return adminRpc<{ id: string }>(
    "admin_override_revoke",
    {
      p_actor: actor.actorId,
      p_actor_role: actor.actorRole,
      p_id: id,
      p_reason: reason,
      p_request_id: actor.audit.requestId,
      p_ip: actor.audit.ip,
      p_user_agent: actor.audit.userAgent,
    },
    "Could not end the override.",
  );
}
