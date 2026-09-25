// mastra.server.ts — the one file that imports @mastra/core. Mastra supplies
// ONLY the workflow graph (step sequencing, retries, per-step observability)
// — it never calls a model directly. Every step in every workflow registered
// here is a thin wrapper around this codebase's own gateways
// (llmJson in ai-gateway.server.ts / firecrawl-gateway.server.ts), so
// checkBudget/recordUsage/Helicone logging all keep working exactly as they
// do for every other call site. Mastra's own `@ai-sdk/*` model-provider
// integrations are never used — adopting them would silently bypass all of
// that (ADR-0019).
//
// No storage is configured: these workflows are short, complete-in-one-call
// pipelines with no suspend/resume needs, and every workflow's actual result
// is persisted into this app's own Supabase tables by its own service layer
// (e.g. competitor_intelligence_runs), not by Mastra.
import "server-only";
import { Mastra } from "@mastra/core";
import { competitorIntelligenceWorkflow } from "@/server/workflows/competitor-intelligence.workflow";
import { geoAeoAuditWorkflow } from "@/server/workflows/geo-aeo-audit.workflow";
import { campaignGenerationWorkflow } from "@/server/workflows/campaign-generation.workflow";
import { marketingCoachWorkflow } from "@/server/workflows/marketing-coach.workflow";
import type {
  CoachSynthesisInput,
  CoachSynthesisResult,
} from "@/server/research/coach-briefing.server";

const mastra = new Mastra({
  workflows: {
    competitorIntelligence: competitorIntelligenceWorkflow,
    geoAeoAudit: geoAeoAuditWorkflow,
    campaignGeneration: campaignGenerationWorkflow,
    marketingCoach: marketingCoachWorkflow,
  },
});

export type WorkflowName =
  "competitorIntelligence" | "geoAeoAudit" | "campaignGeneration" | "marketingCoach";

/** Each workflow's own input shape (mirrors its file's inputSchema). */
export type WorkflowInput = {
  competitorIntelligence: { competitorUrl: string };
  geoAeoAudit: { workspaceId: string; scanId: string; competitorUrls: string[] };
  campaignGeneration: { workspaceId: string; goal: string; channels: string[] };
  marketingCoach: Omit<CoachSynthesisInput, "today"> & { today: string };
};

export type { CoachSynthesisResult };

/**
 * Run a registered workflow to completion and return its result. The one
 * seam feature code calls — nothing outside this file imports @mastra/core.
 * (The `run.start()` cast below is the one place this file's own typing
 * can't express "the union member matching TName" — every actual input is
 * still validated at runtime by that workflow's own zod inputSchema.)
 */
export async function runWorkflow<TName extends WorkflowName, T = unknown>(
  name: TName,
  inputData: WorkflowInput[TName],
): Promise<T> {
  const workflow = mastra.getWorkflow(name);
  if (!workflow) throw new Error(`Unknown Mastra workflow: ${name}`);
  const run = await workflow.createRun();
  const result = await run.start({ inputData } as never);
  if (result.status === "success") return result.result as T;
  if (result.status === "failed") throw result.error;
  throw new Error(`Workflow "${name}" did not complete (status: ${result.status})`);
}
