import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { assertPublicUrl } from "@/server/safe-fetch";

const uuid = z.string().uuid();

/**
 * Combines an already-completed GEO/AEO scan with a Firecrawl-powered
 * competitor comparison (src/server/workflows/geo-aeo-audit.workflow.ts).
 * Spends AI budget (a crawl + a synthesis call per competitor) — editor role
 * required, same as other side-effectful, paid actions.
 */
export const runGeoAeoAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("firecrawl")])
  .inputValidator((d) =>
    z
      .object({
        workspaceId: uuid,
        scanId: uuid,
        competitorUrls: z.array(z.string().min(3).max(2048)).min(1).max(5),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const competitorUrls = data.competitorUrls.map((raw) => {
      const clean = raw.trim().replace(/\/+$/, "");
      const url = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
      assertPublicUrl(url);
      return url;
    });
    const { runWorkflow } = await import("@/server/workflows/mastra.server");
    return runWorkflow("geoAeoAudit", {
      workspaceId: data.workspaceId,
      scanId: data.scanId,
      competitorUrls,
    });
  });
