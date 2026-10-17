// AI usage and cost for the admin console, from the metering rows the gateways
// already write (ai_usage_events). Costs are the providers' reported cost per
// call: an estimate, labelled that way in the console, not an invoice.
import "server-only";
import type { AdminUsage } from "@/lib/admin/types";
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
