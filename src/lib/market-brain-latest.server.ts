import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CACHE_TTL_MS, STALE_PENDING_MS } from "@/lib/dataforseo/google-trends-collection.server";
import type { GoogleTrendsData } from "@/lib/dataforseo/google-trends.server";
import {
  MarketIntelligenceSchema,
  type MarketIntelligence,
} from "@/lib/market-intelligence.server";
import { withMarketTimeout } from "@/lib/market-reliability.server";

// Read-only snapshot of a workspace's Market Brain: the latest measured result
// and its analysis stay available until a newer scan replaces them. No provider
// calls, so this is free to call on every panel open.

export type LatestMarketBrain = {
  result: {
    collectionId: string;
    keywords: string[];
    location: string | null;
    completedAt: string;
    /** null when the latest finished scan found no measurable interest. */
    data: GoogleTrendsData | null;
  } | null;
  intelligence: MarketIntelligence | null;
  /** A scan still running (e.g. started before the panel was closed). */
  activeScan: {
    collectionId: string;
    keywords: string[];
    location: string | null;
    requestedAt: string;
  } | null;
  /** The most recent scan failed; the previous result (if any) is still shown. */
  lastError: { message: string; code?: string } | null;
  schedule: { nextRunAt: string | null; lastRunStatus: string | null } | null;
  /** Until this time a new scan with the same lens is served from cache. */
  freshUntil: string | null;
};

type CollectionRow = {
  id: string;
  status: string;
  keywords: string[];
  location: string | null;
  requested_at: string;
  completed_at: string | null;
  updated_at: string;
  normalized_result: unknown;
  provider_error: unknown;
};

const COLUMNS =
  "id, status, keywords, location, requested_at, completed_at, updated_at, normalized_result, provider_error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(what: string, message: string): never {
  throw new Error(`Failed to read ${what}: ${message}`);
}

export async function getLatestMarketBrain(workspaceId: string): Promise<LatestMarketBrain> {
  const [completedQuery, recentQuery, scheduleQuery] = await Promise.all([
    withMarketTimeout(
      supabaseAdmin
        .from("market_trend_collections")
        .select(COLUMNS)
        .eq("workspace_id", workspaceId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      undefined,
      "Market Brain result lookup timed out",
    ),
    withMarketTimeout(
      supabaseAdmin
        .from("market_trend_collections")
        .select("id, status, keywords, location, requested_at, updated_at, provider_error")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      undefined,
      "Market Brain scan lookup timed out",
    ),
    withMarketTimeout(
      supabaseAdmin
        .from("scheduled_jobs")
        .select("next_run_at, last_run_status")
        .eq("workspace_id", workspaceId)
        .eq("task_type", "market-brain")
        .eq("active", true)
        .limit(1)
        .maybeSingle(),
      undefined,
      "Market Brain schedule lookup timed out",
    ),
  ]);
  if (completedQuery.error) fail("latest market result", completedQuery.error.message);
  if (recentQuery.error) fail("latest market scan", recentQuery.error.message);
  if (scheduleQuery.error) fail("market schedule", scheduleQuery.error.message);

  const completed = completedQuery.data as CollectionRow | null;
  const recent = recentQuery.data as Omit<
    CollectionRow,
    "completed_at" | "normalized_result"
  > | null;

  let intelligence: MarketIntelligence | null = null;
  if (completed?.completed_at && isRecord(completed.normalized_result)) {
    const cacheQuery = await withMarketTimeout(
      supabaseAdmin
        .from("market_intelligence_cache")
        .select("result, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("collection_id", completed.id)
        .eq("analysis_type", "market_strategy")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      undefined,
      "Market intelligence lookup timed out",
    );
    if (cacheQuery.error) fail("market intelligence", cacheQuery.error.message);
    const cached = cacheQuery.data as { result: unknown; updated_at: string } | null;
    // Only the analysis written for this version of the data (rows are refreshed
    // in place, so an older analysis of the same collection can exist).
    if (
      cached &&
      new Date(cached.updated_at).getTime() >= new Date(completed.completed_at).getTime()
    ) {
      const parsed = MarketIntelligenceSchema.safeParse(cached.result);
      if (parsed.success) intelligence = parsed.data;
    }
  }

  const activeScan =
    recent?.status === "pending" &&
    Date.now() - new Date(recent.requested_at).getTime() < STALE_PENDING_MS
      ? {
          collectionId: recent.id,
          keywords: recent.keywords,
          location: recent.location,
          requestedAt: recent.requested_at,
        }
      : null;

  const lastError =
    recent?.status === "failed" && isRecord(recent.provider_error)
      ? {
          message:
            typeof recent.provider_error.message === "string"
              ? recent.provider_error.message
              : "The last market scan failed",
          ...(typeof recent.provider_error.code === "string"
            ? { code: recent.provider_error.code }
            : {}),
        }
      : null;

  const schedule = scheduleQuery.data as {
    next_run_at: string | null;
    last_run_status: string | null;
  } | null;

  return {
    result: completed?.completed_at
      ? {
          collectionId: completed.id,
          keywords: completed.keywords,
          location: completed.location,
          completedAt: completed.completed_at,
          data: isRecord(completed.normalized_result)
            ? (completed.normalized_result as GoogleTrendsData)
            : null,
        }
      : null,
    intelligence,
    activeScan,
    lastError,
    schedule: schedule
      ? { nextRunAt: schedule.next_run_at, lastRunStatus: schedule.last_run_status }
      : null,
    freshUntil: completed?.completed_at
      ? new Date(new Date(completed.completed_at).getTime() + CACHE_TTL_MS).toISOString()
      : null,
  };
}
