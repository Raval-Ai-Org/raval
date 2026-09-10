import { createHash } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { serializeBrandContext, type BrandCtxDna } from "@/lib/ai/brand-context";
import { safeParseJson } from "@/lib/ai/json";
import {
  AnthropicGatewayError,
  claudeTextPrompt,
  selectClaudeModel,
} from "@/lib/anthropic-gateway.server";
import type { GoogleTrendsData } from "@/lib/dataforseo/google-trends.server";

type JsonRecord = Record<string, unknown>;

const Direction = z.enum(["rising", "declining", "stable", "mixed", "unclear"]);
const Priority = z.enum(["high", "medium", "low"]);
const Confidence = z.enum(["high", "medium", "low"]);

const TrendSignalSchema = z
  .object({
    title: z.string().min(1).max(160),
    direction: Direction,
    evidence: z.array(z.string().min(1).max(400)).min(1).max(5),
    significance: z.string().min(1).max(500),
    opportunities: z.array(z.string().min(1).max(300)).max(4),
  })
  .strict();

const OpportunitySchema = z
  .object({
    title: z.string().min(1).max(160),
    explanation: z.string().min(1).max(500),
    targetAudience: z.string().min(1).max(240),
    recommendedAction: z.string().min(1).max(400),
    priority: Priority,
  })
  .strict();

const RecommendationSchema = z
  .object({
    action: z.string().min(1).max(300),
    reason: z.string().min(1).max(400),
    expectedMarketingImpact: z.string().min(1).max(300),
    priority: Priority,
  })
  .strict();

export const MarketIntelligenceSchema = z
  .object({
    summary: z.string().min(1).max(800),
    trendSignals: z.array(TrendSignalSchema).max(8),
    opportunities: z.array(OpportunitySchema).max(8),
    recommendations: z.array(RecommendationSchema).max(8),
    relatedQueries: z.array(z.string().min(1).max(200)).max(20),
    relatedTopics: z.array(z.string().min(1).max(200)).max(20),
    confidence: Confidence,
    generatedAt: z.string().min(1).max(80),
  })
  .strict();

export type MarketIntelligence = z.infer<typeof MarketIntelligenceSchema>;
export type IntelligenceState = "completed" | "cached" | "pending" | "failed" | "no_data";

export type MarketIntelligenceResult = {
  state: IntelligenceState;
  collectionId: string;
  data?: MarketIntelligence;
  error?: { message: string; status?: number; code?: string };
};

export class MarketIntelligenceError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly code = "market_intelligence_error",
  ) {
    super(message);
    this.name = "MarketIntelligenceError";
  }
}

type TrendCollectionRow = {
  id: string;
  workspace_id: string;
  status: string;
  keywords: string[];
  location: string | null;
  language: string | null;
  completed_at: string | null;
  normalized_result: unknown;
  provider_error: unknown;
};

type WorkspaceRow = {
  name: string;
  industry: string | null;
  audience: string | null;
  goals: string | null;
  website_url: string | null;
  brand_voice: unknown;
};

const ANALYSIS_TYPE = "market_strategy";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contextFingerprint(workspace: WorkspaceRow): string {
  const context = JSON.stringify({
    name: workspace.name,
    industry: workspace.industry,
    audience: workspace.audience,
    goals: workspace.goals,
    websiteUrl: workspace.website_url,
    brandVoice: workspace.brand_voice,
  });
  return createHash("sha256").update(context).digest("hex");
}

function analysisKey(collectionId: string, fingerprint: string, analysisType: string): string {
  return createHash("sha256")
    .update(`${collectionId}:${fingerprint}:${analysisType}`)
    .digest("hex");
}

function asBrandDna(workspace: WorkspaceRow): BrandCtxDna {
  return isRecord(workspace.brand_voice) ? (workspace.brand_voice as BrandCtxDna) : {};
}

function serializeTrendEvidence(data: GoogleTrendsData): string {
  return JSON.stringify(
    {
      keywords: data.keywords,
      interestOverTime: data.interestOverTime,
      regionalInterest: data.regionalInterest,
      relatedQueries: data.relatedQueries,
      relatedTopics: data.relatedTopics,
    },
    null,
    2,
  );
}

function buildPrompt(args: {
  collection: TrendCollectionRow;
  workspace: WorkspaceRow;
  brandContext: string;
}): { system: string; user: string } {
  const trendData = args.collection.normalized_result as GoogleTrendsData;
  return {
    system: [
      "You are Ravi, Mellox AI's senior marketing strategist.",
      "Turn the supplied Google Trends evidence into concise, practical marketing intelligence for this business.",
      "Reason in this order: evidence, market signal, business relevance, opportunity, recommended action.",
      "Separate measured evidence from interpretation. Never invent statistics, customer behavior, competitors, market facts, or trend movement.",
      "If evidence is weak or absent, say so and lower confidence. Missing Brand DNA must not block useful but clearly generic recommendations.",
      "Return strict JSON only using exactly the requested schema.",
      "Schema: {summary, trendSignals:[{title,direction,evidence,significance,opportunities}], opportunities:[{title,explanation,targetAudience,recommendedAction,priority}], recommendations:[{action,reason,expectedMarketingImpact,priority}], relatedQueries:string[], relatedTopics:string[], confidence:high|medium|low, generatedAt:string}",
    ].join("\n"),
    user: [
      `Collection date: ${args.collection.completed_at ?? "unknown"}`,
      `Keywords: ${args.collection.keywords.join(", ")}`,
      `Location: ${args.collection.location ?? "global"}`,
      `Language: ${args.collection.language ?? "default"}`,
      `Brand and business context:\n${args.brandContext || "No Brand DNA is available. Do not assume brand-specific facts."}`,
      `Google Trends evidence (measured input only):\n${serializeTrendEvidence(trendData)}`,
    ].join("\n\n"),
  };
}

function parseIntelligence(raw: string): MarketIntelligence {
  const parsed = safeParseJson<unknown>(raw, null);
  const result = MarketIntelligenceSchema.safeParse(parsed);
  if (!result.success) {
    throw new MarketIntelligenceError(
      "Claude returned malformed market intelligence",
      502,
      "malformed_response",
    );
  }
  return { ...result.data, generatedAt: new Date().toISOString() };
}

function providerError(error: unknown): MarketIntelligenceResult["error"] {
  if (error instanceof AnthropicGatewayError) {
    return { message: error.message, status: error.status, code: error.code };
  }
  if (error instanceof MarketIntelligenceError) {
    return { message: error.message, status: error.status, code: error.code };
  }
  return { message: "Market intelligence generation failed", status: 502 };
}

async function loadCollection(
  collectionId: string,
  workspaceId: string,
): Promise<TrendCollectionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("market_trend_collections")
    .select(
      "id, workspace_id, status, keywords, location, language, completed_at, normalized_result, provider_error",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", collectionId)
    .maybeSingle();
  if (error)
    throw new MarketIntelligenceError("Unable to read trend collection", 500, "storage_error");
  return data as TrendCollectionRow | null;
}

async function loadWorkspace(workspaceId: string): Promise<WorkspaceRow | null> {
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .select("name, industry, audience, goals, website_url, brand_voice")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error)
    throw new MarketIntelligenceError("Unable to read business context", 500, "storage_error");
  return data as WorkspaceRow | null;
}

export async function analyzeMarketCollection(args: {
  collectionId: string;
  workspaceId: string;
  analysisType?: string;
}): Promise<MarketIntelligenceResult> {
  const collection = await loadCollection(args.collectionId, args.workspaceId);
  if (!collection) return { state: "no_data", collectionId: args.collectionId };
  if (collection.status === "pending") return { state: "pending", collectionId: args.collectionId };
  if (collection.status === "failed") {
    return {
      state: "failed",
      collectionId: args.collectionId,
      error: isRecord(collection.provider_error)
        ? (collection.provider_error as MarketIntelligenceResult["error"])
        : { message: "Trend collection failed", status: 502 },
    };
  }
  if (collection.status !== "completed" || !isRecord(collection.normalized_result)) {
    return { state: "no_data", collectionId: args.collectionId };
  }

  const workspace = await loadWorkspace(args.workspaceId);
  if (!workspace) return { state: "no_data", collectionId: args.collectionId };
  const type = args.analysisType ?? ANALYSIS_TYPE;
  const fingerprint = contextFingerprint(workspace);
  const key = analysisKey(args.collectionId, fingerprint, type);
  const { data: cached, error: cacheError } = await supabaseAdmin
    .from("market_intelligence_cache")
    .select("result")
    .eq("analysis_key", key)
    .maybeSingle();
  if (cacheError)
    throw new MarketIntelligenceError("Unable to read intelligence cache", 500, "storage_error");
  if (cached?.result) {
    const validated = MarketIntelligenceSchema.safeParse(cached.result);
    if (validated.success)
      return { state: "cached", collectionId: args.collectionId, data: validated.data };
  }

  const brandContext = serializeBrandContext(asBrandDna(workspace), {
    siteUrl: workspace.website_url,
    maxCharsPerField: 500,
  });
  const prompt = buildPrompt({ collection, workspace, brandContext });
  let intelligence: MarketIntelligence;
  try {
    const raw = await claudeTextPrompt({
      route: "market-intelligence",
      system: prompt.system,
      user: prompt.user,
      model: selectClaudeModel("deep-strategy"),
      maxTokens: 3000,
    });
    intelligence = parseIntelligence(raw);
  } catch (error) {
    return { state: "failed", collectionId: args.collectionId, error: providerError(error) };
  }

  const { error: insertError } = await supabaseAdmin.from("market_intelligence_cache").upsert(
    {
      workspace_id: args.workspaceId,
      collection_id: args.collectionId,
      analysis_key: key,
      analysis_type: type,
      context_fingerprint: fingerprint,
      result: intelligence,
    },
    { onConflict: "analysis_key" },
  );
  if (insertError) {
    return {
      state: "failed",
      collectionId: args.collectionId,
      error: { message: "Unable to store market intelligence", status: 500, code: "storage_error" },
    };
  }
  return { state: "completed", collectionId: args.collectionId, data: intelligence };
}
