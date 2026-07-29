import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildSmartSuggestions, type SmartSuggestion as DetSuggestion } from "./ai/deterministic-suggestions";



const uuid = z.string().uuid();

/* ------------------------------------------------------------------ */
/* GEO Audit persistence + trend                                      */
/* ------------------------------------------------------------------ */
export const persistGeoAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        url: z.string().max(2048).optional().nullable(),
        score: z.number().int().min(0).max(100),
        subscores: z.record(z.string(), z.number()).optional(),
        meta: z.record(z.string(), z.any()).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("geo_audit_runs")
      .insert({
        workspace_id: data.workspaceId,
        url: data.url ?? null,
        score: data.score,
        subscores: data.subscores ?? {},
        meta: data.meta ?? {},
        created_by: context.userId,
      })
      .select("id, created_at")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to persist audit");
    return row;
  });

export const getGeoTrend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        days: z.number().int().min(7).max(180).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const days = data.days ?? 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("geo_audit_runs")
      .select("score, subscores, created_at")
      .eq("workspace_id", data.workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    const runs = (rows ?? []) as Array<{
      score: number;
      subscores: Record<string, number>;
      created_at: string;
    }>;
    const latest = runs.length > 0 ? runs[runs.length - 1] : null;
    const avg =
      runs.length > 0
        ? Math.round(runs.reduce((acc, r) => acc + (r.score ?? 0), 0) / runs.length)
        : null;
    return {
      runs: runs.map((r) => ({
        day: r.created_at.slice(0, 10),
        score: r.score,
      })),
      latest,
      avg,
      count: runs.length,
    };
  });

/* ------------------------------------------------------------------ */
/* Hybrid LLM suggestions                                             */
/* ------------------------------------------------------------------ */

export type SmartSuggestion = {
  label: string;
  hint: string;
  prompt: string;
  intent:
    | "geo-audit"
    | "brand-dna"
    | "plan-week"
    | "schedule"
    | "review-drafts"
    | "seo-brief"
    | "share"
    | "ideate"
    | "social"
    | "email"
    | "blog";
};

// The old `callJsonModel` helper is gone — all suggestion calls now go
// through `runJsonPrompt` (shared cache, telemetry, safe parsing).


export const refreshSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        brandContext: z.string().max(6000).optional(),
        lastUserMessage: z.string().max(1500).optional(),
        max: z.number().int().min(3).max(8).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const max = data.max ?? 5;
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();

    // Gather grounding signals
    const [publishedRecent, scheduledNext, draftsCount, blogCount, sharesCount, latestAudit, insights] =
      await Promise.all([
        context.supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", data.workspaceId)
          .eq("status", "published")
          .gte("updated_at", weekAgo),
        context.supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", data.workspaceId)
          .eq("status", "scheduled")
          .lte("scheduled_at", nextWeek),
        context.supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", data.workspaceId)
          .in("status", ["draft", "pending"]),
        context.supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", data.workspaceId)
          .in("kind", ["blog", "brief"]),
        context.supabase
          .from("client_shares")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", data.workspaceId),
        context.supabase
          .from("geo_audit_runs")
          .select("score, subscores, created_at")
          .eq("workspace_id", data.workspaceId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        context.supabase
          .from("memory_insights")
          .select("body")
          .eq("workspace_id", data.workspaceId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    const signals = {
      publishedLast7d: publishedRecent.count ?? 0,
      scheduledNext7d: scheduledNext.count ?? 0,
      pendingDrafts: draftsCount.count ?? 0,
      hasBlog: (blogCount.count ?? 0) > 0,
      shares: sharesCount.count ?? 0,
      latestGeoScore: latestAudit.data?.score ?? null,
      latestGeoAt: latestAudit.data?.created_at ?? null,
      insights: (insights.data ?? []).map((r) => r.body).slice(0, 12),
    };

    // Deterministic — no LLM needed. Pure signal→template mapping.
    const suggestions: DetSuggestion[] = buildSmartSuggestions(
      signals,
      data.brandContext,
      max,
    );

    return { suggestions, signals };

  });


/* ------------------------------------------------------------------ */
/* Memory insights persistence                                        */
/* ------------------------------------------------------------------ */
export const upsertMemoryInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        items: z
          .array(
            z.object({
              body: z.string().min(3).max(500),
              kind: z.string().max(40).optional(),
              sourceLabel: z.string().max(120).optional().nullable(),
              meta: z.record(z.string(), z.any()).optional(),
            }),
          )
          .min(1)
          .max(40),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const rows = data.items.map((it) => ({
      workspace_id: data.workspaceId,
      kind: it.kind ?? "insight",
      body: it.body.trim(),
      source_label: it.sourceLabel ?? null,
      meta: it.meta ?? {},
      created_by: context.userId,
    }));
    const { data: inserted, error } = await context.supabase
      .from("memory_insights")
      .upsert(rows, { onConflict: "workspace_id,body", ignoreDuplicates: true })
      .select("id, body, kind, source_label, created_at");
    if (error) {
      // upsert with unique-on-expression may not work — fall back to insert and ignore conflicts
      const { data: ins } = await context.supabase
        .from("memory_insights")
        .insert(rows)
        .select("id, body, kind, source_label, created_at");
      return { inserted: ins ?? [] };
    }
    return { inserted: inserted ?? [] };
  });

export const listMemoryInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, limit: z.number().int().min(1).max(200).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("memory_insights")
      .select("id, body, kind, source_label, created_at")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 60);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
