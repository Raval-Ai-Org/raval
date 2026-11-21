// AI usage and cost for the admin console, from the metering rows the gateways
// already write (ai_usage_events). Costs are the providers' reported cost per
// call: an estimate, labelled that way in the console, not an invoice.
import "server-only";
import type { AdminCostPerOutput, AdminUsage } from "@/lib/admin/types";
import { adminRpc } from "./db.server";

type Num = number | string | null;
type Raw = {
  generated_at: string;
  since: string;
  totals: Record<string, Num>;
  by_day: Array<{ day: string; calls: Num; cost_usd: Num; errors: Num }>;
  by_kind: Array<{ kind: string; calls: Num; cost_usd: Num }>;
  by_model: Array<{
    provider: string;
    model: string;
    calls: Num;
    cost_usd: Num;
    errors: Num;
    avg_latency_ms: Num;
  }>;
  by_route: Array<{ route: string; calls: Num; cost_usd: Num; errors: Num }>;
  top_workspaces: Array<{ workspace_id: string; name: string | null; calls: Num; cost_usd: Num }>;
};

const n = (value: unknown) => Number(value ?? 0);

export async function getUsage(days: number): Promise<AdminUsage> {
  const raw = await adminRpc<Raw>("admin_usage", { p_days: days }, "Usage is unavailable.");
  return {
    generatedAt: raw.generated_at,
    since: raw.since,
    days,
    totals: {
      calls: n(raw.totals.calls),
      costUsd: n(raw.totals.cost_usd),
      savedUsd: n(raw.totals.saved_usd),
      errors: n(raw.totals.errors),
      cached: n(raw.totals.cached),
      inputTokens: n(raw.totals.input_tokens),
      outputTokens: n(raw.totals.output_tokens),
    },
    byDay: raw.by_day.map((r) => ({
      day: r.day,
      calls: n(r.calls),
      costUsd: n(r.cost_usd),
      errors: n(r.errors),
    })),
    byKind: raw.by_kind.map((r) => ({ kind: r.kind, calls: n(r.calls), costUsd: n(r.cost_usd) })),
    byModel: raw.by_model.map((r) => ({
      provider: r.provider,
      model: r.model,
      calls: n(r.calls),
      costUsd: n(r.cost_usd),
      errors: n(r.errors),
      avgLatencyMs: r.avg_latency_ms === null ? null : n(r.avg_latency_ms),
    })),
    byRoute: raw.by_route.map((r) => ({
      route: r.route,
      calls: n(r.calls),
      costUsd: n(r.cost_usd),
      errors: n(r.errors),
    })),
    topWorkspaces: raw.top_workspaces.map((r) => ({
      workspaceId: r.workspace_id,
      name: r.name,
      calls: n(r.calls),
      costUsd: n(r.cost_usd),
    })),
  };
}

type Row = Record<string, Num | string | boolean>;
const nOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** Cost per Studio job / UGC render, per stage, and prompt-cache read share per route. */
export async function getCostPerOutput(days: number): Promise<AdminCostPerOutput> {
  const raw = await adminRpc<{
    generated_at: string;
    since: string;
    totals: Row;
    by_variant: Row[];
    by_stage: Row[];
    prompt_cache: Row[];
  }>("admin_cost_per_output", { p_days: days }, "Cost per piece is unavailable.");
  return {
    generatedAt: raw.generated_at,
    since: raw.since,
    days,
    totals: {
      costUsd: n(raw.totals.cost_usd),
      attributedCostUsd: n(raw.totals.attributed_cost_usd),
      errorCostUsd: n(raw.totals.error_cost_usd),
      savedUsd: n(raw.totals.saved_usd),
      inputTokens: n(raw.totals.input_tokens),
      cachedInputTokens: n(raw.totals.cached_input_tokens),
      reasoningTokens: n(raw.totals.reasoning_tokens),
    },
    byVariant: (raw.by_variant ?? []).map((r) => ({
      kind: String(r.kind),
      variant: String(r.variant ?? "unknown"),
      workflows: n(r.workflows),
      succeeded: n(r.succeeded),
      failed: n(r.failed),
      accepted: n(r.accepted),
      revisions: n(r.revisions),
      costUsd: n(r.cost_usd),
      failedCostUsd: n(r.failed_cost_usd),
      errorCallCostUsd: n(r.error_call_cost_usd),
      costPerWorkflowUsd: nOrNull(r.cost_per_workflow_usd),
      costPerSucceededUsd: nOrNull(r.cost_per_succeeded_usd),
      costPerAcceptedUsd: nOrNull(r.cost_per_accepted_usd),
    })),
    byStage: (raw.by_stage ?? []).map((r) => ({
      workflow: String(r.workflow),
      stage: String(r.stage),
      usageKind: String(r.usage_kind),
      calls: n(r.calls),
      costUsd: n(r.cost_usd),
    })),
    promptCache: (raw.prompt_cache ?? []).map((r) => ({
      route: String(r.route),
      inputTokens: n(r.input_tokens),
      cachedInputTokens: n(r.cached_input_tokens),
      cacheWriteTokens: n(r.cache_write_tokens),
      reasoningTokens: n(r.reasoning_tokens),
      cachedShare: nOrNull(r.cached_share),
      costUsd: n(r.cost_usd),
    })),
  };
}
