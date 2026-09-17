// geo-aeo-audit.workflow.ts — sequences an EXISTING GEO/AEO scan (read-only)
// with a Firecrawl-powered competitor comparison into one report. Does NOT
// touch src/server/geo/agents/** (the GEO coding agent's fix pipeline) or
// the scan engine itself (src/server/geo/scan-runner.server.ts) — this
// workflow only reads an already-completed scan's stored result; creating
// or driving a scan stays entirely the existing leased/cron-driven system's
// job (ADR-0019).
//
// The caller is responsible for workspace authorization before invoking this
// workflow (matching the rest of this codebase's "thin fn layer checks
// access, service layer trusts the caller" pattern) — steps here read via
// supabaseAdmin, scoped to the workspaceId the caller already verified.
import "server-only";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { competitorIntelligenceWorkflow } from "@/server/workflows/competitor-intelligence.workflow";

const scanSummarySchema = z.object({
  scanId: z.string(),
  url: z.string(),
  host: z.string(),
  status: z.string(),
  overallScore: z.number().nullable(),
  categoryScores: z.record(z.string(), z.number()),
});

const competitorProfileSchema = z.object({
  competitorUrl: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  positioning: z.string().optional(),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
  differentiators: z.array(z.string()).optional(),
});

const readScanStep = createStep({
  id: "read-geo-scan",
  inputSchema: z.object({
    workspaceId: z.string(),
    scanId: z.string(),
    competitorUrls: z.array(z.string()).max(5),
  }),
  outputSchema: z.object({ scan: scanSummarySchema, competitorUrls: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { SCAN_VIEW_COLS, presentScan } = await import("@/server/geo/present");
    const { data, error } = await supabaseAdmin
      .from("geo_scans")
      .select(SCAN_VIEW_COLS)
      .eq("id", inputData.scanId)
      .eq("workspace_id", inputData.workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("GEO scan not found for this workspace.");
    const view = presentScan(data);
    return {
      scan: {
        scanId: view.id,
        url: view.url,
        host: view.host,
        status: view.status,
        overallScore: view.overallScore,
        categoryScores: view.categoryScores as Record<string, number>,
      },
      competitorUrls: inputData.competitorUrls,
    };
  },
});

const compareCompetitorsStep = createStep({
  id: "compare-competitors",
  inputSchema: z.object({ scan: scanSummarySchema, competitorUrls: z.array(z.string()) }),
  outputSchema: z.object({
    scan: scanSummarySchema,
    competitors: z.array(competitorProfileSchema),
  }),
  execute: async ({ inputData }) => {
    // Nested Mastra workflow (not the plain runCompetitorIntel() function) —
    // each competitor gets the same crawl/synthesize retry behavior as a
    // standalone competitor-intelligence run.
    const competitors = await Promise.all(
      inputData.competitorUrls.map(async (competitorUrl) => {
        try {
          const run = await competitorIntelligenceWorkflow.createRun();
          const result = await run.start({ inputData: { competitorUrl } });
          if (result.status !== "success") {
            const message =
              result.status === "failed" ? result.error.message : `status: ${result.status}`;
            return { competitorUrl, ok: false as const, error: message };
          }
          return {
            competitorUrl,
            ok: true as const,
            positioning: result.result.positioning,
            strengths: result.result.strengths,
            weaknesses: result.result.weaknesses,
            differentiators: result.result.differentiators,
          };
        } catch (error) {
          return {
            competitorUrl,
            ok: false as const,
            error: error instanceof Error ? error.message : "Competitor analysis failed",
          };
        }
      }),
    );
    return { scan: inputData.scan, competitors };
  },
});

export const geoAeoAuditWorkflow = createWorkflow({
  id: "geo-aeo-audit",
  inputSchema: z.object({
    workspaceId: z.string(),
    scanId: z.string(),
    // Kept small deliberately: each entry is a full Firecrawl crawl + a
    // Claude synthesis call, run sequentially.
    competitorUrls: z.array(z.string()).max(5),
  }),
  outputSchema: z.object({
    scan: scanSummarySchema,
    competitors: z.array(competitorProfileSchema),
  }),
})
  .then(readScanStep)
  .then(compareCompetitorsStep)
  .commit();
