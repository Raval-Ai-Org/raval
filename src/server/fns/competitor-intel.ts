import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { assertPublicUrl } from "@/server/safe-fetch";
import type { CompetitorIntelRun } from "@/server/research/competitor-intel.server";

const uuid = z.string().uuid();

export const startCompetitorIntel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("firecrawl")])
  .inputValidator((d) =>
    z
      .object({
        workspaceId: uuid,
        competitorUrl: z.string().min(3).max(2048),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const clean = data.competitorUrl.trim().replace(/\/+$/, "");
    const url = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    try {
      assertPublicUrl(url);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Invalid URL");
    }
    const { startCompetitorIntelRun } = await import("@/server/research/competitor-intel.server");
    return startCompetitorIntelRun({
      workspaceId: data.workspaceId,
      competitorUrl: url,
      userId: context.userId,
    });
  });

export const getCompetitorIntelRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("competitor_intelligence_runs")
      .select(
        "id, workspace_id, competitor_url, status, pages_crawled, result, error, created_at, completed_at",
      )
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Not found");
    return row as CompetitorIntelRun;
  });

export const listCompetitorIntelRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        workspaceId: uuid,
        limit: z.number().int().min(1).max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("competitor_intelligence_runs")
      .select(
        "id, workspace_id, competitor_url, status, pages_crawled, result, error, created_at, completed_at",
      )
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 20);
    if (error) throw new Error(error.message);
    return (rows ?? []) as CompetitorIntelRun[];
  });
