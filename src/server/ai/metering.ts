// metering.ts — every paid provider call is recorded (proposal workstream B:
// "Usage metering — every model call recorded to the database: workspace,
// route, model, tokens and estimated cost").
//
// Writes go through public.record_ai_usage(), which inserts the event and
// folds it into the per-workspace and per-user daily rollups atomically.
// Fire-and-forget: metering must never fail or slow the request it measures.
// Truncated completions are additionally logged as guardrail events so a cut-off
// answer is a monitored signal, not a console line nobody reads.
import "server-only";
import { getRequestScope } from "@/server/request-context";
import { logGuardrailEvent } from "@/server/guardrails/events";

export type UsageKind = "text" | "image" | "video" | "search" | "moderation";
export type UsageStatus = "ok" | "error" | "blocked" | "degraded";

export type UsageEvent = {
  provider: "openrouter" | "anthropic" | "kie" | "dataforseo";
  model: string;
  kind?: UsageKind;
  inputTokens?: number;
  outputTokens?: number;
  units?: number;
  cached?: boolean;
  truncated?: boolean;
  estCostUsd?: number;
  /** Cost avoided by a cache hit (for the savings figure). */
  savedUsd?: number;
  latencyMs?: number;
  status?: UsageStatus;
  /** Overrides for work outside a request scope (cron jobs, agent workers). */
  route?: string;
  workspaceId?: string | null;
  userId?: string | null;
};

export type UsageRecord = Record<string, unknown>;
export type UsageSink = (row: UsageRecord) => Promise<void>;

let sink: UsageSink = async (row) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("record_ai_usage", { p_event: row as never });
  if (error) throw new Error(error.message);
};

/** Tests swap the sink to observe metering without a database. */
export function setUsageSink(next: UsageSink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

/** Build the row exactly as record_ai_usage() expects it. Exported for tests. */
export function toUsageRow(event: UsageEvent): UsageRecord {
  const scope = getRequestScope();
  return {
    workspace_id: event.workspaceId !== undefined ? event.workspaceId : (scope.workspaceId ?? null),
    user_id: event.userId !== undefined ? event.userId : (scope.userId ?? null),
    route: event.route ?? scope.route ?? "unknown",
    provider: event.provider,
    model: event.model,
    kind: event.kind ?? "text",
    input_tokens: Math.max(0, Math.round(event.inputTokens ?? 0)),
    output_tokens: Math.max(0, Math.round(event.outputTokens ?? 0)),
    units: Math.max(0, Math.round(event.units ?? 0)),
    cached: event.cached ?? false,
    truncated: event.truncated ?? false,
    est_cost_usd: event.cached ? 0 : Math.max(0, event.estCostUsd ?? 0),
    saved_usd: Math.max(0, event.savedUsd ?? 0),
    latency_ms: event.latencyMs != null ? Math.round(event.latencyMs) : null,
    status: event.status ?? "ok",
    run_id: scope.runId ?? null,
    request_id: scope.requestId ?? null,
  };
}

/** Record one provider call. Never throws. */
export function recordUsage(event: UsageEvent): void {
  const row = toUsageRow(event);
  if (event.truncated) {
    logGuardrailEvent({
      kind: "truncation",
      severity: "warn",
      route: String(row.route),
      workspaceId: row.workspace_id as string | null,
      userId: row.user_id as string | null,
      detail: { model: event.model, outputTokens: row.output_tokens },
    });
  }
  void sink(row).catch((error) => {
    console.error("[metering] usage not recorded", error instanceof Error ? error.message : error);
  });
}
