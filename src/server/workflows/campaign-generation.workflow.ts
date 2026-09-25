// campaign-generation.workflow.ts — a small multi-step campaign brief
// generator: gather the workspace's stored Brand DNA, then synthesize a
// grounded campaign brief with Claude (src/server/research/campaign-brief.server.ts).
// This is new functionality (no prior "campaign generation" feature existed),
// deliberately scoped small — a brief with content ideas, not a full
// campaign-management feature with its own storage/UI, which was never
// specified and would be a separate, larger product decision.
//
// The caller is responsible for workspace authorization before invoking this
// workflow, matching every other workflow here (ADR-0019).
import "server-only";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { generateCampaignBrief } from "@/server/research/campaign-brief.server";

const brandContextSchema = z.object({
  brandName: z.string(),
  oneLiner: z.string(),
  about: z.string(),
  audience: z.string(),
  voice: z.string(),
  values: z.string(),
  products: z.string(),
});

const campaignBriefSchema = z.object({
  theme: z.string(),
  keyMessage: z.string(),
  targetAudience: z.string(),
  callToAction: z.string(),
  contentIdeas: z.array(z.object({ channel: z.string(), idea: z.string(), hook: z.string() })),
});

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const gatherBrandContextStep = createStep({
  id: "gather-brand-context",
  inputSchema: z.object({
    workspaceId: z.string(),
    goal: z.string(),
    channels: z.array(z.string()),
  }),
  outputSchema: z.object({
    brand: brandContextSchema,
    goal: z.string(),
    channels: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readBrandDna } = await import("@/server/workspaces/brand-dna.server");
    const stored = await readBrandDna(supabaseAdmin, inputData.workspaceId);
    const dna = stored?.dna ?? {};
    // The workspace's default Style sets the voice when it has one.
    const { loadResolvedStyle } = await import("@/server/brand-kit/resolve.server");
    const style = await loadResolvedStyle(inputData.workspaceId, null, { dna }).catch(() => null);
    const styleVoice = style?.resolved.styleId ? style.resolved.writing.voice : undefined;
    return {
      brand: {
        brandName: asText(dna.brandName),
        oneLiner: asText(dna.oneLiner),
        about: asText(dna.about),
        audience: asText(dna.audience),
        voice: asText(styleVoice ?? dna.voice),
        values: asText(dna.values),
        products: asText(dna.products),
      },
      goal: inputData.goal,
      channels: inputData.channels,
    };
  },
});

const generateBriefStep = createStep({
  id: "generate-campaign-brief",
  inputSchema: z.object({
    brand: brandContextSchema,
    goal: z.string(),
    channels: z.array(z.string()),
  }),
  outputSchema: campaignBriefSchema,
  retries: 1,
  execute: async ({ inputData }) => {
    return generateCampaignBrief(inputData.brand, inputData.goal, inputData.channels);
  },
});

export const campaignGenerationWorkflow = createWorkflow({
  id: "campaign-generation",
  inputSchema: z.object({
    workspaceId: z.string(),
    goal: z.string(),
    channels: z.array(z.string()).min(1).max(6),
  }),
  outputSchema: campaignBriefSchema,
})
  .then(gatherBrandContextStep)
  .then(generateBriefStep)
  .commit();
