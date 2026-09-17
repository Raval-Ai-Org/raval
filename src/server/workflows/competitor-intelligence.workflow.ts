// competitor-intelligence.workflow.ts — Mastra orchestration on top of the
// already-working, already-tested pipeline in
// src/server/research/competitor-intel.server.ts. Splitting crawl and
// synthesis into two Mastra steps means a transient failure in either stage
// is retried independently (Mastra's per-step `retries`) and shows up as two
// distinct spans instead of one opaque call — real value on top of the exact
// same underlying logic, not a rewrite of it.
import "server-only";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  crawlCompetitorPages,
  synthesizeCompetitorProfile,
} from "@/server/research/competitor-intel.server";

const competitorIntelResultSchema = z.object({
  positioning: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  targetAudience: z.string(),
  pricingSignals: z.string(),
  differentiators: z.array(z.string()),
  contentThemes: z.array(z.string()),
  evidence: z.array(z.object({ claim: z.string(), source: z.string() })),
  pagesCrawled: z.array(z.string()),
});

const firecrawlPageSchema = z.object({
  url: z.string(),
  markdown: z.string(),
  links: z.array(z.string()),
  title: z.string().optional(),
  description: z.string().optional(),
});

const crawlStep = createStep({
  id: "crawl-competitor-site",
  inputSchema: z.object({ competitorUrl: z.string() }),
  outputSchema: z.object({ competitorUrl: z.string(), pages: z.array(firecrawlPageSchema) }),
  retries: 1,
  execute: async ({ inputData }) => {
    const pages = await crawlCompetitorPages(inputData.competitorUrl);
    return { competitorUrl: inputData.competitorUrl, pages };
  },
});

const synthesizeStep = createStep({
  id: "synthesize-competitor-profile",
  inputSchema: z.object({ competitorUrl: z.string(), pages: z.array(firecrawlPageSchema) }),
  outputSchema: competitorIntelResultSchema,
  execute: async ({ inputData }) => {
    return synthesizeCompetitorProfile(inputData.competitorUrl, inputData.pages);
  },
});

export const competitorIntelligenceWorkflow = createWorkflow({
  id: "competitor-intelligence",
  inputSchema: z.object({ competitorUrl: z.string() }),
  outputSchema: competitorIntelResultSchema,
})
  .then(crawlStep)
  .then(synthesizeStep)
  .commit();
