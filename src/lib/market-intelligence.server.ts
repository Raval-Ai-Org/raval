import "server-only";
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
import { marketLog, withMarketTimeout } from "@/lib/market-reliability.server";

type JsonRecord = Record<string, unknown>;

const Direction = z.enum(["rising", "declining", "stable", "mixed", "unclear"]);
const Priority = z.enum(["high", "medium", "low"]);
const Confidence = z.enum(["high", "medium", "low"]);

const TrendSignalSchema = z.object({
  title: z.string().min(1).max(200),
  direction: Direction,
  evidence: z.array(z.string().min(1).max(600)).min(1).max(5),
  significance: z.string().min(1).max(800),
  opportunities: z.array(z.string().min(1).max(400)).max(4),
});

const OpportunitySchema = z.object({
  title: z.string().min(1).max(200),
  explanation: z.string().min(1).max(800),
  targetAudience: z.string().min(1).max(400),
  recommendedAction: z.string().min(1).max(600),
  priority: Priority,
});

const RecommendationSchema = z.object({
  action: z.string().min(1).max(400),
  reason: z.string().min(1).max(600),
  expectedMarketingImpact: z.string().min(1).max(400),
  priority: Priority,
});

export const MarketIntelligenceSchema = z.object({
  summary: z.string().min(1).max(1200),
  trendSignals: z.array(TrendSignalSchema).max(8),
  opportunities: z.array(OpportunitySchema).max(8),
  recommendations: z.array(RecommendationSchema).max(8),
  relatedQueries: z.array(z.string().min(1).max(200)).max(20),
  relatedTopics: z.array(z.string().min(1).max(200)).max(20),
  confidence: Confidence,
  generatedAt: z.string().min(1).max(80),
});

const stringList = { type: "array", items: { type: "string" } } as const;

// Structured-output schema sent to Claude (output_config.format). The API does not
// enforce length or item-count limits, so the prompt states them and
// parseIntelligence() enforces them with MarketIntelligenceSchema. generatedAt is
// stamped server-side and therefore not requested from the model.
export const MARKET_INTELLIGENCE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "trendSignals",
    "opportunities",
    "recommendations",
    "relatedQueries",
    "relatedTopics",
    "confidence",
  ],
  properties: {
    summary: { type: "string" },
    trendSignals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "direction", "evidence", "significance", "opportunities"],
        properties: {
          title: { type: "string" },
          direction: { type: "string", enum: Direction.options },
          evidence: stringList,
          significance: { type: "string" },
          opportunities: stringList,
        },
      },
    },
    opportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "explanation", "targetAudience", "recommendedAction", "priority"],
        properties: {
          title: { type: "string" },
          explanation: { type: "string" },
          targetAudience: { type: "string" },
          recommendedAction: { type: "string" },
          priority: { type: "string", enum: Priority.options },
        },
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "reason", "expectedMarketingImpact", "priority"],
        properties: {
          action: { type: "string" },
          reason: { type: "string" },
          expectedMarketingImpact: { type: "string" },
          priority: { type: "string", enum: Priority.options },
        },
      },
    },
    relatedQueries: stringList,
    relatedTopics: stringList,
    confidence: { type: "string", enum: Confidence.options },
  },
} as const;

// Opus 5 thinks adaptively by default and thinking tokens share max_tokens; the
// ceiling must cover thinking plus a full answer (the old 3000 truncated the JSON).
const CLAUDE_MAX_TOKENS = 16_000;
// Measured end-to-end at 34-38s for a typical collection (output generation
// dominates). Bounded per attempt; one retry covers fast transient failures
// (429/5xx/529). MARKET_INTELLIGENCE_ROUTE_TIMEOUT_MS is the overall backstop.
const CLAUDE_TIMEOUT_MS = 65_000;

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

// A collection row is refreshed in place when its data expires, keeping its id,
// so the key includes completed_at: new trend data must never hit old analysis.
function analysisKey(
  collection: Pick<TrendCollectionRow, "id" | "completed_at">,
  fingerprint: string,
  analysisType: string,
): string {
  return createHash("sha256")
    .update(`${collection.id}:${collection.completed_at ?? ""}:${fingerprint}:${analysisType}`)
    .digest("hex");
}

function asBrandDna(workspace: WorkspaceRow): BrandCtxDna {
  return isRecord(workspace.brand_voice) ? (workspace.brand_voice as BrandCtxDna) : {};
}

function serializeTrendEvidence(data: GoogleTrendsData): string {
  // Compact JSON: the same measured evidence at roughly half the input tokens.
  return JSON.stringify({
    keywords: data.keywords,
    interestOverTime: data.interestOverTime,
    regionalInterest: data.regionalInterest,
    relatedQueries: data.relatedQueries,
    relatedTopics: data.relatedTopics,
  });
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
      "Keep it concise: summary under 600 characters; at most 5 trendSignals (1-3 evidence items and at most 3 opportunities each), 5 opportunities, 5 recommendations, 10 relatedQueries and 10 relatedTopics; keep every text field under 300 characters.",
      "relatedQueries and relatedTopics must only contain queries and topic titles present in the supplied evidence.",
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

const LIST_LIMITS = {
  trendSignals: 8,
  opportunities: 8,
  recommendations: 8,
  relatedQueries: 20,
  relatedTopics: 20,
} as const;

// Item-count limits are presentation limits: extra items are dropped rather than
// failing an otherwise valid analysis. Content is never rewritten.
function capLists(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const capped: JsonRecord = { ...value };
  for (const [key, limit] of Object.entries(LIST_LIMITS)) {
    if (Array.isArray(capped[key])) capped[key] = (capped[key] as unknown[]).slice(0, limit);
  }
  if (Array.isArray(capped.trendSignals)) {
    capped.trendSignals = capped.trendSignals.map((signal) =>
      isRecord(signal)
        ? {
            ...signal,
            evidence: Array.isArray(signal.evidence)
              ? signal.evidence.slice(0, 5)
              : signal.evidence,
            opportunities: Array.isArray(signal.opportunities)
              ? signal.opportunities.slice(0, 4)
              : signal.opportunities,
          }
        : signal,
    );
  }
  return capped;
}

export function parseIntelligence(raw: string): MarketIntelligence {
  const parsed = safeParseJson<unknown>(raw, null);
  const result = MarketIntelligenceSchema.safeParse({
    ...(capLists(parsed) as JsonRecord),
    generatedAt: new Date().toISOString(),
  });
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new MarketIntelligenceError(
      `Claude returned malformed market intelligence${
        issue ? ` (${issue.path.join(".") || "root"}: ${issue.message})` : ""
      }`,
      502,
      "malformed_response",
    );
  }
  return result.data;
}

function providerError(error: unknown): NonNullable<MarketIntelligenceResult["error"]> {
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
  operation = "unknown",
): Promise<TrendCollectionRow | null> {
  const query = supabaseAdmin
    .from("market_trend_collections")
    .select(
      "id, workspace_id, status, keywords, location, language, completed_at, normalized_result, provider_error",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", collectionId);
  const { data, error } = await withMarketTimeout(
    query.maybeSingle(),
    undefined,
    "Market collection lookup timed out",
  );
  if (error)
    throw new MarketIntelligenceError("Unable to read trend collection", 500, "storage_error");
  return data as TrendCollectionRow | null;
}

async function loadWorkspace(
  workspaceId: string,
  operation = "unknown",
): Promise<WorkspaceRow | null> {
  const query = supabaseAdmin
    .from("workspaces")
    .select("name, industry, audience, goals, website_url, brand_voice")
    .eq("id", workspaceId);
  const { data, error } = await withMarketTimeout(
    query.maybeSingle(),
    undefined,
    "Business context lookup timed out",
  );
  if (error)
    throw new MarketIntelligenceError("Unable to read business context", 500, "storage_error");
  return data as WorkspaceRow | null;
}

export async function analyzeMarketCollection(args: {
  collectionId: string;
  workspaceId: string;
  analysisType?: string;
  operation?: string;
}): Promise<MarketIntelligenceResult> {
  const operation = args.operation ?? "unknown";
  marketLog("intelligence request started", { operation, collectionId: args.collectionId });
  const collection = await loadCollection(args.collectionId, args.workspaceId, operation);
  if (!collection) return { state: "no_data", collectionId: args.collectionId };
  if (collection.status === "pending") {
    marketLog("intelligence collection pending", { operation, collectionId: args.collectionId });
    return { state: "pending", collectionId: args.collectionId };
  }
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

  const workspace = await loadWorkspace(args.workspaceId, operation);
  if (!workspace) return { state: "no_data", collectionId: args.collectionId };
  const type = args.analysisType ?? ANALYSIS_TYPE;
  const fingerprint = contextFingerprint(workspace);
  const key = analysisKey(collection, fingerprint, type);
  const cacheQuery = supabaseAdmin
    .from("market_intelligence_cache")
    .select("result")
    .eq("analysis_key", key);
  const { data: cached, error: cacheError } = await withMarketTimeout(
    cacheQuery.maybeSingle(),
    undefined,
    "Market intelligence cache lookup timed out",
  );
  if (cacheError)
    throw new MarketIntelligenceError("Unable to read intelligence cache", 500, "storage_error");
  if (cached?.result) {
    const validated = MarketIntelligenceSchema.safeParse(cached.result);
    if (validated.success) {
      marketLog("intelligence cache hit", { operation, collectionId: args.collectionId });
      return { state: "cached", collectionId: args.collectionId, data: validated.data };
    }
    // An unreadable cache entry is regenerated (and overwritten) below.
    marketLog("intelligence cache entry invalid; regenerating", {
      operation,
      collectionId: args.collectionId,
    });
  }

  const brandContext = serializeBrandContext(asBrandDna(workspace), {
    siteUrl: workspace.website_url,
    maxCharsPerField: 500,
  });
  const prompt = buildPrompt({ collection, workspace, brandContext });
  const model = selectClaudeModel("deep-strategy");
  const startedAt = Date.now();
  let intelligence: MarketIntelligence;
  try {
    marketLog("Claude intelligence request started", {
      operation,
      collectionId: args.collectionId,
      model,
      promptChars: prompt.system.length + prompt.user.length,
    });
    const raw = await claudeTextPrompt({
      route: "market-intelligence",
      system: prompt.system,
      user: prompt.user,
      model,
      maxTokens: CLAUDE_MAX_TOKENS,
      // Interactive route: medium effort keeps thinking (and latency) bounded;
      // the task is a structured summary of supplied evidence, not open research.
      effort: "medium",
      outputSchema: MARKET_INTELLIGENCE_OUTPUT_SCHEMA,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      retries: 1,
    });
    intelligence = parseIntelligence(raw);
    marketLog("Claude response received", {
      operation,
      collectionId: args.collectionId,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const details = providerError(error);
    marketLog("Claude intelligence request failed", {
      operation,
      collectionId: args.collectionId,
      model,
      durationMs: Date.now() - startedAt,
      code: details.code,
      status: details.status,
      message: details.message,
    });
    return { state: "failed", collectionId: args.collectionId, error: details };
  }

  const cacheWrite = supabaseAdmin.from("market_intelligence_cache").upsert(
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
  const { error: insertError } = await withMarketTimeout(
    cacheWrite,
    undefined,
    "Market intelligence cache write timed out",
  );
  if (insertError) {
    // The analysis is valid and already paid for: return it, and log the storage
    // failure so it is visible (the next request regenerates instead of hitting cache).
    marketLog("intelligence cache write failed", {
      operation,
      collectionId: args.collectionId,
      code: insertError.code,
      message: insertError.message,
    });
    return { state: "completed", collectionId: args.collectionId, data: intelligence };
  }
  marketLog("intelligence cache written", { operation, collectionId: args.collectionId });
  return { state: "completed", collectionId: args.collectionId, data: intelligence };
}
