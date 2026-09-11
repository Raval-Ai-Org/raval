// budget.ts — per-workspace spend ceilings and plan quotas (proposal workstream
// B: "Plan-based quotas — soft warning then a hard cap" and "Spend ceilings —
// per-workspace daily and monthly cost limits, degrading gracefully rather than
// failing").
//
// Every paid gateway calls checkBudget(kind) before spending. Decisions:
//   ok       — under 80% of every limit
//   warn     — at/over 80%: proceed, and the response carries X-Usage-Warning
//   degrade  — text over a ceiling: proceed on a cheaper model with a smaller
//              output cap (the product keeps working, spend is contained)
//   block    — images/videos/search over quota or ceiling: BudgetExceededError (429)
//
// The spend being checked is the metered spend (ai_usage_daily via
// public.ai_usage_summary), cached for 30 s per scope. FAIL-OPEN like the rate
// limiter: if the usage store is unreachable the request proceeds — a metering
// outage must not take the product down.
import "server-only";
import { cache } from "@/server/cache/store";
import { getRequestScope, setRequestScope } from "@/server/request-context";
import { logGuardrailEvent } from "@/server/guardrails/events";
import { getPlanLimits, SOFT_LIMIT_RATIO, userDailyCeilingUsd, type PlanLimits } from "@/server/plans";

export type BudgetKind = "text" | "image" | "video" | "search";
export type BudgetMode = "ok" | "warn" | "degrade" | "block";

export type UsageSummary = {
  todayCostUsd: number;
  monthCostUsd: number;
  monthImages: number;
  monthVideos: number;
  monthCalls: number;
  monthCachedCalls: number;
  monthSavedUsd: number;
};

export type BudgetDecision = {
  mode: BudgetMode;
  scope: "workspace" | "user" | "none";
  reason?: string;
  usage?: UsageSummary;
  limits?: Pick<PlanLimits, "dailyUsd" | "monthlyUsd" | "monthlyImages" | "monthlyVideos"> & {
    plan: string;
  };
};

export class BudgetExceededError extends Error {
  readonly status = 429;
  constructor(
    readonly kind: BudgetKind,
    message: string,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

const SUMMARY_TTL_SECONDS = 30;
const PLAN_TTL_SECONDS = 300;

export type BudgetDeps = {
  summary: (scopeKey: string) => Promise<UsageSummary | null>;
  plan: (workspaceId: string) => Promise<string | null>;
};

const defaultDeps: BudgetDeps = {
  async summary(scopeKey) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("ai_usage_summary", { p_scope_key: scopeKey });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      todayCostUsd: Number(row.today_cost_usd ?? 0),
      monthCostUsd: Number(row.month_cost_usd ?? 0),
      monthImages: Number(row.month_images ?? 0),
      monthVideos: Number(row.month_videos ?? 0),
      monthCalls: Number(row.month_calls ?? 0),
      monthCachedCalls: Number(row.month_cached_calls ?? 0),
      monthSavedUsd: Number(row.month_saved_usd ?? 0),
    };
  },
  async plan(workspaceId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("workspaces")
      .select("plan")
      .eq("id", workspaceId)
      .maybeSingle();
    return (data as { plan?: string } | null)?.plan ?? null;
  },
};

let deps: BudgetDeps = defaultDeps;

/** Tests inject usage/plan sources. */
export function setBudgetDeps(next: Partial<BudgetDeps> | null): void {
  deps = next ? { ...defaultDeps, ...next } : defaultDeps;
}

async function cachedSummary(scopeKey: string): Promise<UsageSummary | null> {
  const key = `budget:summary:${scopeKey}`;
  const hit = await cache.get<UsageSummary>(key);
  if (hit) return hit;
  const fresh = await deps.summary(scopeKey);
  if (fresh) await cache.set(key, fresh, SUMMARY_TTL_SECONDS);
  return fresh;
}

async function cachedPlan(workspaceId: string): Promise<string | null> {
  const key = `budget:plan:${workspaceId}`;
  const hit = await cache.get<{ plan: string | null }>(key);
  if (hit) return hit.plan;
  const plan = await deps.plan(workspaceId);
  await cache.set(key, { plan }, PLAN_TTL_SECONDS);
  return plan;
}

/** Drop the cached summary after a known spend, so the next check is exact. */
export async function invalidateBudgetCache(scopeKey: string): Promise<void> {
  await cache.del(`budget:summary:${scopeKey}`);
}

function ratio(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? Infinity : 0;
  return used / limit;
}

/** Pure decision function — exported for tests. */
export function decide(
  kind: BudgetKind,
  usage: UsageSummary,
  limits: { dailyUsd: number; monthlyUsd: number; monthlyImages: number; monthlyVideos: number },
): { mode: BudgetMode; reason?: string } {
  const spend = Math.max(ratio(usage.todayCostUsd, limits.dailyUsd), ratio(usage.monthCostUsd, limits.monthlyUsd));
  const quota =
    kind === "image"
      ? ratio(usage.monthImages, limits.monthlyImages)
      : kind === "video"
        ? ratio(usage.monthVideos, limits.monthlyVideos)
        : 0;

  if (kind === "image" || kind === "video") {
    if (quota >= 1) {
      return { mode: "block", reason: `Monthly ${kind} quota reached for this plan.` };
    }
    if (spend >= 1) return { mode: "block", reason: "AI spend limit reached for this period." };
  } else if (spend >= 1) {
    return kind === "text"
      ? { mode: "degrade", reason: "AI spend limit reached — using the economy model." }
      : { mode: "block", reason: "AI spend limit reached for this period." };
  }
  if (Math.max(spend, quota) >= SOFT_LIMIT_RATIO) {
    const pct = Math.round(Math.max(spend, quota) * 100);
    return { mode: "warn", reason: `${pct}% of this plan's AI allowance used.` };
  }
  return { mode: "ok" };
}

/** Log a budget event at most once per scope per hour. */
async function noteBudgetEvent(scopeKey: string, mode: BudgetMode, kind: BudgetKind, reason?: string) {
  if (mode !== "degrade" && mode !== "block") return;
  const flag = `budget:event:${scopeKey}:${mode}:${kind}:${new Date().toISOString().slice(0, 13)}`;
  if ((await cache.incr(flag, 3600)) > 1) return;
  logGuardrailEvent({
    kind: mode === "block" ? "budget_exceeded" : "budget_degraded",
    severity: mode === "block" ? "block" : "warn",
    detail: { kind, scope: scopeKey.split(":")[0], reason },
  });
}

/**
 * Decide whether a metered call of `kind` may run for the current caller.
 * Never throws (see enforceBudget for the throwing variant).
 */
export async function checkBudget(
  kind: BudgetKind,
  opts: { workspaceId?: string | null; userId?: string | null } = {},
): Promise<BudgetDecision> {
  const scope = getRequestScope();
  const workspaceId = opts.workspaceId !== undefined ? opts.workspaceId : scope.workspaceId;
  const userId = opts.userId !== undefined ? opts.userId : scope.userId;

  try {
    if (workspaceId) {
      const scopeKey = `ws:${workspaceId}`;
      const [usage, planId] = await Promise.all([cachedSummary(scopeKey), cachedPlan(workspaceId)]);
      const limits = getPlanLimits(planId);
      const summary = usage ?? emptySummary();
      const verdict = decide(kind, summary, limits);
      await noteBudgetEvent(scopeKey, verdict.mode, kind, verdict.reason);
      if (verdict.mode === "warn" && verdict.reason) setRequestScope({ usageWarning: verdict.reason });
      return {
        ...verdict,
        scope: "workspace",
        usage: summary,
        limits: {
          plan: limits.id,
          dailyUsd: limits.dailyUsd,
          monthlyUsd: limits.monthlyUsd,
          monthlyImages: limits.monthlyImages,
          monthlyVideos: limits.monthlyVideos,
        },
      };
    }
    if (userId) {
      const scopeKey = `user:${userId}`;
      const summary = (await cachedSummary(scopeKey)) ?? emptySummary();
      const daily = userDailyCeilingUsd();
      const limits = { dailyUsd: daily, monthlyUsd: daily * 31, monthlyImages: 50, monthlyVideos: 3 };
      const verdict = decide(kind, summary, limits);
      await noteBudgetEvent(scopeKey, verdict.mode, kind, verdict.reason);
      if (verdict.mode === "warn" && verdict.reason) setRequestScope({ usageWarning: verdict.reason });
      return { ...verdict, scope: "user", usage: summary, limits: { plan: "personal", ...limits } };
    }
    return { mode: "ok", scope: "none" };
  } catch (error) {
    console.error(
      "[budget] check failed, failing open",
      error instanceof Error ? error.message : error,
    );
    return { mode: "ok", scope: "none" };
  }
}

/** checkBudget, throwing BudgetExceededError when the call must not run. */
export async function enforceBudget(
  kind: BudgetKind,
  opts: { workspaceId?: string | null; userId?: string | null } = {},
): Promise<BudgetDecision> {
  const decision = await checkBudget(kind, opts);
  if (decision.mode === "block") {
    throw new BudgetExceededError(kind, decision.reason ?? "AI allowance reached for this period.");
  }
  return decision;
}

function emptySummary(): UsageSummary {
  return {
    todayCostUsd: 0,
    monthCostUsd: 0,
    monthImages: 0,
    monthVideos: 0,
    monthCalls: 0,
    monthCachedCalls: 0,
    monthSavedUsd: 0,
  };
}
