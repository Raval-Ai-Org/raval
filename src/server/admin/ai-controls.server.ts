// AI controls for the admin console: model routing overrides and spend caps.
// task-models.ts stays the baseline; an override sits below the AI_MODEL_<ROUTE>
// environment variables and may only name a model the built-in plans already
// use. Caps are enforced in checkBudget. Every change and its audit row are
// written together by a database function.
import "server-only";
import type { AdminAiControls, AdminAiRoute, AdminSpendCap } from "@/lib/admin/types";
import {
  knownModels,
  registeredRoutes,
  registryPlan,
  routeEnvKey,
  type Effort,
} from "@/server/ai/task-models";
import { refreshRoutingOverrides } from "@/server/platform/routing-overrides.server";
import { clearSpendCapCache, loadPlatformSpend } from "@/server/platform/spend-caps.server";
import { HttpError } from "@/server/http-error";
import type { AuditContext } from "./audit.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

type Actor = { actorId: string; actorRole: string; audit: AuditContext };

type OverrideRow = { route_key: string; models: string[] | null; effort: Effort | null };
type CapRow = {
  scope: "global" | "workspace";
  workspace_id: string | null;
  daily_usd: number | string | null;
  monthly_usd: number | string | null;
  updated_at: string;
};

const num = (value: number | string | null) => (value === null ? null : Number(value));

function envList(raw: string | undefined): string[] | null {
  const list = (raw ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

export async function getAiControls(): Promise<AdminAiControls> {
  const [overrides, capRows] = await Promise.all([
    adminDb.from("model_route_overrides").select("route_key,models,effort").limit(500),
    adminDb
      .from("spend_caps")
      .select("scope,workspace_id,daily_usd,monthly_usd,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500),
  ]);
  if (overrides.error) throw httpErrorFromPg(overrides.error, "Could not read routing.");
  if (capRows.error) throw httpErrorFromPg(capRows.error, "Could not read spend caps.");

  const byRoute = new Map(
    ((overrides.data ?? []) as OverrideRow[]).map((row) => [row.route_key, row]),
  );
  const allowed = knownModels();

  const routes: AdminAiRoute[] = registeredRoutes()
    .sort()
    .map((route) => {
      const base = registryPlan(route);
      const row = byRoute.get(route);
      const key = routeEnvKey(route);
      const envModels = envList(process.env[`AI_MODEL_${key}`]);
      const envEffort = process.env[`AI_EFFORT_${key}`]?.trim().toLowerCase() ?? "";
      const hasEnvEffort = ["low", "medium", "high"].includes(envEffort);
      const overrideModels = row?.models?.filter((m) => allowed.has(m)) ?? null;
      const models = envModels ?? (overrideModels?.length ? overrideModels : base?.models) ?? [];
      const effort = (hasEnvEffort ? (envEffort as Effort) : (row?.effort ?? base?.effort)) ?? null;
      const source: AdminAiRoute["source"] =
        envModels || hasEnvEffort ? "environment" : row ? "override" : "default";
      return {
        route,
        source,
        models,
        effort,
        defaultModels: base?.models ?? [],
        defaultEffort: base?.effort ?? null,
        override: row ? { models: row.models, effort: row.effort } : null,
      };
    });

  const caps = (capRows.data ?? []) as CapRow[];
  const workspaceIds = caps.flatMap((cap) => (cap.workspace_id ? [cap.workspace_id] : []));
  const names = new Map<string, string>();
  if (workspaceIds.length) {
    const { data } = await adminDb.from("workspaces").select("id,name").in("id", workspaceIds);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
      names.set(row.id, row.name);
    }
  }

  const spend = await loadPlatformSpend().catch(() => null);

  return {
    generatedAt: new Date().toISOString(),
    routes,
    models: [...allowed].sort(),
    caps: caps.map((cap): AdminSpendCap => ({
      scope: cap.scope,
      workspaceId: cap.workspace_id,
      workspaceName: cap.workspace_id ? (names.get(cap.workspace_id) ?? null) : null,
      dailyUsd: num(cap.daily_usd),
      monthlyUsd: num(cap.monthly_usd),
      updatedAt: cap.updated_at,
    })),
    spend,
  };
}

export type RouteOverrideInput = {
  route: string;
  /** null for both models and effort clears the override. */
  models: string[] | null;
  effort: Effort | null;
  reason: string;
};

export async function setRouteOverride(actor: Actor, input: RouteOverrideInput) {
  if (!registeredRoutes().includes(input.route)) throw new HttpError(400, "Unknown route.");
  if (input.models) {
    const allowed = knownModels();
    const bad = input.models.find((model) => !allowed.has(model));
    if (bad) throw new HttpError(400, `"${bad}" is not a model Mellox's plans use.`);
    if (new Set(input.models).size !== input.models.length) {
      throw new HttpError(400, "A model is listed twice.");
    }
  }
  const result = await adminRpc<{ route: string; cleared: boolean }>(
    "admin_route_override_set",
    {
      p_actor: actor.actorId,
      p_actor_role: actor.actorRole,
      p_route: input.route,
      p_models: input.models,
      p_effort: input.effort,
      p_reason: input.reason,
      p_request_id: actor.audit.requestId,
      p_ip: actor.audit.ip,
      p_user_agent: actor.audit.userAgent,
    },
    "Could not save the override.",
  );
  await refreshRoutingOverrides(true);
  return result;
}

export type SpendCapInput = {
  scope: "global" | "workspace";
  workspaceId: string | null;
  /** null for both limits removes the cap. */
  dailyUsd: number | null;
  monthlyUsd: number | null;
  reason: string;
};

export async function setSpendCap(actor: Actor, input: SpendCapInput) {
  if (input.scope === "workspace" && !input.workspaceId) {
    throw new HttpError(400, "Choose a workspace.");
  }
  if (input.dailyUsd !== null && input.monthlyUsd !== null && input.monthlyUsd < input.dailyUsd) {
    throw new HttpError(400, "The monthly limit cannot be below the daily one.");
  }
  const result = await adminRpc<{ scope: string; removed: boolean }>(
    "admin_spend_cap_set",
    {
      p_actor: actor.actorId,
      p_actor_role: actor.actorRole,
      p_scope: input.scope,
      p_workspace: input.scope === "workspace" ? input.workspaceId : null,
      p_daily: input.dailyUsd,
      p_monthly: input.monthlyUsd,
      p_reason: input.reason,
      p_request_id: actor.audit.requestId,
      p_ip: actor.audit.ip,
      p_user_agent: actor.audit.userAgent,
    },
    "Could not save the cap.",
  );
  clearSpendCapCache();
  return result;
}
