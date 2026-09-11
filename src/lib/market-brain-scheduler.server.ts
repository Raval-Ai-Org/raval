import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  pollGoogleTrendsCollection,
  requestGoogleTrendsCollection,
} from "@/lib/dataforseo/google-trends-collection.server";
import { analyzeMarketCollection } from "@/lib/market-intelligence.server";

export type MarketBrainScheduleConfig = {
  workspaceId: string;
  keywords: string[];
  location?: string | null;
  language?: string | null;
  timeRange?: string;
  dateFrom?: string;
  dateTo?: string;
};

const DAILY_COLLECTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PENDING_RETRY_INTERVAL_MS = 10 * 60 * 1000;
const STALE_PENDING_MS = 40 * 60 * 1000;
const MARKET_BRAIN_TASK_TYPE = "market-brain";
const MARKET_BRAIN_TITLE = "Market Brain daily collection";

type MarketBrainJob = {
  id: string;
  workspace_id: string;
  next_run_at: string;
  meta: Record<string, unknown>;
};

function normalizeKeywords(keywords: string[]): string[] {
  return Array.from(
    new Set(
      keywords
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 5),
    ),
  );
}

function buildScheduleKey(
  workspaceId: string,
  keywords: string[],
  location?: string | null,
): string {
  return createHash("sha256")
    .update(`${workspaceId}:${normalizeKeywords(keywords).join("|")}:${location ?? "global"}`)
    .digest("hex");
}

function nextRunAt(delayMs: number): string {
  return new Date(Date.now() + delayMs).toISOString();
}

function scheduleMeta(args: MarketBrainScheduleConfig): Record<string, unknown> {
  return {
    schedule_key: buildScheduleKey(args.workspaceId, args.keywords, args.location),
    keywords: normalizeKeywords(args.keywords),
    location: args.location ?? null,
    language: args.language ?? null,
    time_range: args.timeRange ?? null,
    date_from: args.dateFrom ?? null,
    date_to: args.dateTo ?? null,
  };
}

export async function ensureMarketBrainSchedule(
  args: MarketBrainScheduleConfig,
): Promise<{ ok: true }> {
  const meta = scheduleMeta(args);
  if (!Array.isArray(meta.keywords) || !meta.keywords.length) return { ok: true };

  const { data: existing, error: readError } = await supabaseAdmin
    .from("scheduled_jobs")
    .select("id, active, next_run_at, meta")
    .eq("workspace_id", args.workspaceId)
    .eq("task_type", MARKET_BRAIN_TASK_TYPE)
    .eq("title", MARKET_BRAIN_TITLE)
    .maybeSingle();
  if (readError) throw new Error(`Failed to read Market Brain schedule: ${readError.message}`);

  if (existing) {
    const existingMeta = (existing.meta ?? {}) as Record<string, unknown>;
    const next =
      existing.active && new Date(existing.next_run_at).getTime() > Date.now()
        ? existing.next_run_at
        : nextRunAt(DAILY_COLLECTION_INTERVAL_MS);
    const { error } = await supabaseAdmin
      .from("scheduled_jobs")
      .update({
        active: true,
        cadence: "daily",
        next_run_at: next,
        meta: { ...existingMeta, ...meta } as never,
      })
      .eq("id", existing.id);
    if (error) throw new Error(`Failed to update Market Brain schedule: ${error.message}`);
    return { ok: true };
  }

  const { error: insertError } = await supabaseAdmin.from("scheduled_jobs").insert({
    workspace_id: args.workspaceId,
    title: MARKET_BRAIN_TITLE,
    task_type: MARKET_BRAIN_TASK_TYPE,
    agent: "ravi",
    cadence: "daily",
    timezone: "UTC",
    next_run_at: nextRunAt(DAILY_COLLECTION_INTERVAL_MS),
    last_run_status: "scheduled",
    meta: meta as never,
  });
  if (insertError)
    throw new Error(`Failed to create Market Brain schedule: ${insertError.message}`);
  return { ok: true };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function runMarketBrainJob(job: MarketBrainJob): Promise<"completed" | "pending" | "failed"> {
  const started = await requestGoogleTrendsCollection(
    {
      keywords: stringArray(job.meta.keywords),
      location: stringValue(job.meta.location),
      language: stringValue(job.meta.language),
      dateFrom: stringValue(job.meta.date_from),
      dateTo: stringValue(job.meta.date_to),
      timeRange: stringValue(job.meta.time_range) as
        | "past_hour"
        | "past_4_hours"
        | "past_day"
        | "past_7_days"
        | "past_30_days"
        | "past_90_days"
        | "past_12_months"
        | "past_5_years"
        | "2004_present"
        | undefined,
    },
    job.workspace_id,
  );

  const result =
    started.collectionId && started.state === "pending"
      ? await pollGoogleTrendsCollection(started.collectionId)
      : started;
  if (!result.collectionId || result.state === "failed") return "failed";
  if (result.state === "pending") return "pending";
  // The provider answered with no measurable interest: a successful run with
  // nothing to analyze, not an error.
  if (result.state === "no_data") return "completed";

  const intelligence = await analyzeMarketCollection({
    collectionId: result.collectionId,
    workspaceId: job.workspace_id,
    analysisType: "market_strategy",
  });
  return intelligence.state === "completed" || intelligence.state === "cached"
    ? "completed"
    : "failed";
}

export async function runDueMarketBrainCollections(
  opts: { workspaceId?: string; max?: number } = {},
) {
  let query = supabaseAdmin
    .from("scheduled_jobs")
    .select("id, workspace_id, next_run_at, meta")
    .eq("task_type", MARKET_BRAIN_TASK_TYPE)
    .eq("active", true)
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(opts.max ?? 25);
  if (opts.workspaceId) query = query.eq("workspace_id", opts.workspaceId);

  const { data: jobs, error } = await query;
  if (error) throw new Error(error.message);
  if (!jobs?.length) return { ran: 0, skipped: 0 };

  let ran = 0;
  for (const row of jobs) {
    const job = row as MarketBrainJob;
    let status: "completed" | "pending" | "failed" = "failed";
    let errorMessage: string | null = null;
    try {
      status = await runMarketBrainJob(job);
      if (status === "completed") ran += 1;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    const pending = status === "pending";
    const { error: updateError } = await supabaseAdmin
      .from("scheduled_jobs")
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: status === "completed" ? "ok" : pending ? "pending" : "error",
        last_run_error: errorMessage,
        run_count: 1,
        next_run_at: nextRunAt(pending ? PENDING_RETRY_INTERVAL_MS : DAILY_COLLECTION_INTERVAL_MS),
      })
      .eq("id", job.id);
    if (updateError) throw new Error(updateError.message);
  }

  return { ran, skipped: jobs.length - ran };
}

export function isStaleMarketBrainCollection(collectionUpdatedAt: string | null): boolean {
  if (!collectionUpdatedAt) return true;
  return Date.now() - new Date(collectionUpdatedAt).getTime() > STALE_PENDING_MS;
}
