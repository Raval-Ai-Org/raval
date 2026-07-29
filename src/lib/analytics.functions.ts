import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

export type AnalyticsSummary = {
  totals: {
    items: number;
    drafts: number;
    pending: number;
    approved: number;
    scheduled: number;
    published: number;
  };
  deltas: {
    items: number; // last 14d vs prior 14d, percentage
    published: number;
  };
  daily: Array<{ day: string; created: number; scheduled: number; published: number }>;
  byChannel: Array<{ channel: string; count: number }>;
  byAgent: Array<{ agent: string; count: number }>;
  byKind: Array<{ kind: string; count: number }>;
  approvals: { pending: number; approved: number; rejected: number };
  recent: Array<{
    id: string;
    title: string | null;
    status: string;
    channel: string | null;
    agent: string;
    created_at: string;
  }>;
  drafts: Array<{
    id: string;
    title: string | null;
    kind: string;
    channel: string | null;
    status: string;
    updated_at: string;
    words: number;
  }>;
  upcoming: Array<{
    id: string;
    title: string;
    channel: string | null;
    agent: string;
    next_run_at: string;
    cadence: string;
    active: boolean;
  }>;
  latestAudit: null | {
    id: string;
    url: string | null;
    score: number;
    subscores: Record<string, number>;
    created_at: string;
    topActions: Array<{ id: string; priority: string; title: string; detail: string }>;
  };
  workspace: { name: string | null; website_url: string | null } | null;
};

function pctDelta(curr: number, prev: number) {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

export const getAnalyticsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, days: z.number().int().min(7).max(90).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const days = data.days ?? 14;
    const now = new Date();
    const since = new Date(now.getTime() - days * 86_400_000);
    const prevSince = new Date(now.getTime() - days * 2 * 86_400_000);

    const { data: rows, error } = await context.supabase
      .from("content_items")
      .select("id, title, status, channel, agent, kind, body, created_at, scheduled_at, updated_at")
      .eq("workspace_id", data.workspaceId)
      .gte("created_at", prevSince.toISOString())
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);

    const items = rows ?? [];

    const totals = {
      items: items.length,
      drafts: items.filter((r) => r.status === "draft").length,
      pending: items.filter((r) => r.status === "pending").length,
      approved: items.filter((r) => r.status === "approved").length,
      scheduled: items.filter((r) => r.status === "scheduled").length,
      published: items.filter((r) => r.status === "published").length,
    };

    const sinceMs = since.getTime();
    const inWindow = items.filter((r) => new Date(r.created_at).getTime() >= sinceMs);
    const inPrev = items.filter((r) => new Date(r.created_at).getTime() < sinceMs);

    const deltas = {
      items: pctDelta(inWindow.length, inPrev.length),
      published: pctDelta(
        inWindow.filter((r) => r.status === "published").length,
        inPrev.filter((r) => r.status === "published").length,
      ),
    };

    const buckets = new Map<string, { created: number; scheduled: number; published: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { created: 0, scheduled: 0, published: 0 });
    }
    for (const r of inWindow) {
      const key = (r.created_at as string).slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      b.created += 1;
      if (r.status === "scheduled") b.scheduled += 1;
      if (r.status === "published") b.published += 1;
    }
    const daily = Array.from(buckets.entries()).map(([day, v]) => ({
      day: day.slice(5),
      ...v,
    }));

    const channelMap = new Map<string, number>();
    const agentMap = new Map<string, number>();
    const kindMap = new Map<string, number>();
    for (const r of items) {
      const c = (r.channel ?? "unassigned") as string;
      channelMap.set(c, (channelMap.get(c) ?? 0) + 1);
      const a = (r.agent ?? "spark") as string;
      agentMap.set(a, (agentMap.get(a) ?? 0) + 1);
      const k = ((r as { kind?: string }).kind ?? "post") as string;
      kindMap.set(k, (kindMap.get(k) ?? 0) + 1);
    }

    const byChannel = Array.from(channelMap.entries())
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count);
    const byAgent = Array.from(agentMap.entries())
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => b.count - a.count);
    const byKind = Array.from(kindMap.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count);

    const { data: approvalRows } = await context.supabase
      .from("approvals")
      .select("status")
      .eq("workspace_id", data.workspaceId)
      .limit(500);
    const approvals = {
      pending: (approvalRows ?? []).filter((r) => r.status === "pending").length,
      approved: (approvalRows ?? []).filter((r) => r.status === "approved").length,
      rejected: (approvalRows ?? []).filter((r) => r.status === "rejected").length,
    };

    const recent = items.slice(0, 8).map((r) => ({
      id: r.id as string,
      title: (r.title as string | null) ?? null,
      status: r.status as string,
      channel: (r.channel as string | null) ?? null,
      agent: r.agent as string,
      created_at: r.created_at as string,
    }));

    const drafts = items
      .filter((r) => r.status === "draft" || r.status === "pending" || r.status === "in_review")
      .slice(0, 12)
      .map((r) => {
        const body = ((r as { body?: string | null }).body ?? "") as string;
        const words = body ? body.trim().split(/\s+/).filter(Boolean).length : 0;
        return {
          id: r.id as string,
          title: (r.title as string | null) ?? null,
          kind: ((r as { kind?: string }).kind ?? "post") as string,
          channel: (r.channel as string | null) ?? null,
          status: r.status as string,
          updated_at: (r.updated_at as string) ?? (r.created_at as string),
          words,
        };
      });

    // Upcoming scheduled jobs
    const { data: jobRows } = await context.supabase
      .from("scheduled_jobs")
      .select("id, title, channel, agent, next_run_at, cadence, active")
      .eq("workspace_id", data.workspaceId)
      .eq("active", true)
      .order("next_run_at", { ascending: true })
      .limit(10);
    const upcoming = (jobRows ?? []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      channel: (r.channel as string | null) ?? null,
      agent: r.agent as string,
      next_run_at: r.next_run_at as string,
      cadence: r.cadence as string,
      active: r.active as boolean,
    }));

    // Latest GEO audit
    const { data: auditRow } = await context.supabase
      .from("geo_audit_runs")
      .select("id, url, score, subscores, meta, created_at")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const meta = (auditRow?.meta ?? {}) as { actions?: Array<{ id: string; priority: string; title: string; detail: string }> };
    const latestAudit = auditRow
      ? {
          id: auditRow.id as string,
          url: (auditRow.url as string | null) ?? null,
          score: auditRow.score as number,
          subscores: (auditRow.subscores ?? {}) as Record<string, number>,
          created_at: auditRow.created_at as string,
          topActions: (meta.actions ?? []).slice(0, 6),
        }
      : null;

    // Workspace basics
    const { data: wsRow } = await context.supabase
      .from("workspaces")
      .select("name, website_url")
      .eq("id", data.workspaceId)
      .maybeSingle();
    const workspace = wsRow
      ? { name: (wsRow.name as string | null) ?? null, website_url: (wsRow.website_url as string | null) ?? null }
      : null;

    return {
      totals,
      deltas,
      daily,
      byChannel,
      byAgent,
      byKind,
      approvals,
      recent,
      drafts,
      upcoming,
      latestAudit,
      workspace,
    } satisfies AnalyticsSummary;
  });

export type DrilldownItem = {
  id: string;
  title: string | null;
  status: string;
  channel: string | null;
  agent: string;
  kind: string;
  created_at: string;
  updated_at: string;
  words: number;
};

export const getAnalyticsDrilldown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        dimension: z.enum(["channel", "agent", "kind"]),
        value: z.string().min(1).max(200),
        days: z.number().int().min(7).max(90).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const days = data.days ?? 14;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const column = data.dimension === "channel" ? "channel" : data.dimension === "agent" ? "agent" : "kind";
    const q = context.supabase
      .from("content_items")
      .select("id, title, status, channel, agent, kind, body, created_at, updated_at")
      .eq("workspace_id", data.workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    const { data: rows, error } = data.value === "(none)"
      ? await q.is(column, null)
      : await q.eq(column, data.value);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      title: (r.title as string | null) ?? null,
      status: r.status as string,
      channel: (r.channel as string | null) ?? null,
      agent: r.agent as string,
      kind: r.kind as string,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
      words: typeof r.body === "string" ? r.body.trim().split(/\s+/).filter(Boolean).length : 0,
    })) satisfies DrilldownItem[];
  });

