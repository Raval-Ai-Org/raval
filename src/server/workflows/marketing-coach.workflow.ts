// marketing-coach.workflow.ts — Mastra wrapper around
// src/server/research/coach-briefing.server.ts's synthesizeCoachBriefing().
// Deliberately a SINGLE step, not a multi-step decomposition: the DB-gathering
// half of Marketing Coach (8 parallel RLS-scoped Supabase reads in
// src/server/fns/coach.ts) stays entirely in that request-scoped handler,
// using the caller's own session — not supabaseAdmin — so this workflow
// receives already-gathered signals/research as plain input, never a DB
// client. Off by default (FEATURE_FLAG_MARKETING_COACH_WORKFLOW_ENABLED);
// when off, getCoachBriefing() calls synthesizeCoachBriefing() directly and
// this file is never touched at runtime. See ADR-0019/0021.
import "server-only";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { synthesizeCoachBriefing } from "@/server/research/coach-briefing.server";

const coachActionSchema = z.object({
  label: z.string(),
  prompt: z.string(),
  intent: z.string(),
});

const coachInsightSchema = z.object({
  title: z.string(),
  detail: z.string(),
  tone: z.string().optional(),
  action: coachActionSchema.optional(),
  source: z.string().optional(),
});

const coachBriefingSchema = z.object({
  greeting: z.string(),
  headline: z.string(),
  focus: z.object({ title: z.string(), why: z.string(), action: coachActionSchema }),
  wins: z.array(coachInsightSchema),
  risks: z.array(coachInsightSchema),
  competitors: z.array(coachInsightSchema),
  market: z.array(coachInsightSchema),
  plays: z.array(coachInsightSchema),
  weekPlan: z.array(z.string()),
  sources: z.array(z.object({ label: z.string(), url: z.string() })),
  brandSnapshot: z
    .object({
      name: z.string().optional(),
      oneLiner: z.string().optional(),
      industry: z.string().optional(),
      website: z.string().optional(),
    })
    .optional(),
  generatedAt: z.string(),
});

const searchResultSchema = z.object({ title: z.string(), url: z.string(), snippet: z.string() });

const signalsSchema = z.object({
  workspaceName: z.string(),
  website: z.string().nullable(),
  publishedLast7d: z.number(),
  scheduledNext7d: z.number(),
  pendingDrafts: z.number(),
  latestGeoScore: z.number().nullable(),
  previousGeoScore: z.number().nullable(),
  geoSubscores: z.unknown(),
  recentInsights: z.array(z.string()),
  recentContent: z.array(z.string()),
});

const inputSchema = z.object({
  today: z.string(), // ISO — reconstructed to a Date inside the step
  dayName: z.string(),
  siteUrl: z.string().nullable(),
  brandSeed: z.string(),
  model: z.string(),
  signals: signalsSchema,
  brandContext: z.string().optional(),
  siteText: z.string(),
  siteMeta: z.record(z.string(), z.string()),
  compResults: z.array(searchResultSchema),
  reviewResults: z.array(searchResultSchema),
  trendResults: z.array(searchResultSchema),
});

const outputSchema = z.object({ briefing: coachBriefingSchema, hasContent: z.boolean() });

const synthesizeStep = createStep({
  id: "synthesize-coach-briefing",
  inputSchema,
  outputSchema,
  retries: 1,
  execute: async ({ inputData }) => {
    return synthesizeCoachBriefing({ ...inputData, today: new Date(inputData.today) });
  },
});

export const marketingCoachWorkflow = createWorkflow({
  id: "marketing-coach",
  inputSchema,
  outputSchema,
})
  .then(synthesizeStep)
  .commit();
