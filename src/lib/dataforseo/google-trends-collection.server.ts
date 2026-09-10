import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesUpdate } from "@/integrations/supabase/types";
import {
  createGoogleTrendsTask,
  DataForSeoError,
  getGoogleTrendsTask,
  type GoogleTrendsData,
  type GoogleTrendsInput,
} from "@/lib/dataforseo/google-trends.server";

export type TrendCollectionState = "cached" | "pending" | "completed" | "failed" | "no_data";

export type TrendCollectionResult = {
  state: TrendCollectionState;
  collectionId: string | null;
  taskId: string | null;
  data?: GoogleTrendsData;
  error?: { message: string; status?: number; providerCode?: number };
};

type CollectionRow = {
  id: string;
  workspace_id: string;
  request_key: string;
  provider: string;
  keywords: string[];
  location: string | null;
  language: string | null;
  date_from: string | null;
  date_to: string | null;
  time_range: string | null;
  dataforseo_task_id: string | null;
  status: string;
  normalized_result: unknown;
  provider_error: unknown;
  requested_at: string;
  last_polled_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 1000;
const STALE_PENDING_MS = 20 * 60 * 1000;
const inflight = new Map<string, Promise<TrendCollectionResult>>();

function canonicalInput(input: GoogleTrendsInput): string {
  return JSON.stringify({
    keywords: input.keywords.map((keyword) => keyword.trim()).filter(Boolean),
    location: input.location?.trim() || null,
    language: input.language?.trim() || null,
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
    timeRange: input.timeRange ?? null,
  });
}

export function trendRequestKey(input: GoogleTrendsInput): string {
  return createHash("sha256").update(canonicalInput(input)).digest("hex");
}

function resultFromRow(row: CollectionRow, state: TrendCollectionState): TrendCollectionResult {
  const data = row.normalized_result as GoogleTrendsData | null;
  return {
    state: data ? state : state === "cached" || state === "completed" ? "no_data" : state,
    collectionId: row.id,
    taskId: row.dataforseo_task_id,
    ...(data ? { data } : {}),
    ...(row.provider_error && typeof row.provider_error === "object"
      ? { error: row.provider_error as TrendCollectionResult["error"] }
      : {}),
  };
}

function providerError(error: unknown): TrendCollectionResult["error"] {
  if (error instanceof DataForSeoError) {
    return { message: error.message, status: error.status, providerCode: error.code };
  }
  return { message: "Google Trends collection failed", status: 502 };
}

async function getRow(requestKey: string, workspaceId: string): Promise<CollectionRow | null> {
  const query = supabaseAdmin
    .from("market_trend_collections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("request_key", requestKey);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("Failed to read Google Trends cache");
  return data as CollectionRow | null;
}

async function updateRow(
  id: string,
  values: TablesUpdate<"market_trend_collections">,
): Promise<CollectionRow> {
  const { data, error } = await supabaseAdmin
    .from("market_trend_collections")
    .update(values)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error("Failed to update Google Trends collection");
  return data as CollectionRow;
}

async function createPendingRow(
  input: GoogleTrendsInput,
  requestKey: string,
  workspaceId: string,
): Promise<{ row: CollectionRow; created: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("market_trend_collections")
    .insert({
      workspace_id: workspaceId,
      request_key: requestKey,
      keywords: input.keywords,
      location: input.location ?? null,
      language: input.language ?? null,
      date_from: input.dateFrom ?? null,
      date_to: input.dateTo ?? null,
      time_range: input.timeRange ?? null,
      status: "pending",
    })
    .select("*")
    .single();
  if (!error && data) return { row: data as CollectionRow, created: true };
  const existing = await getRow(requestKey, workspaceId);
  if (existing) return { row: existing, created: false };
  throw new Error("Failed to create Google Trends collection");
}

async function startCollection(input: GoogleTrendsInput, workspaceId: string): Promise<TrendCollectionResult> {
  const requestKey = trendRequestKey(input);
  let row = await getRow(requestKey, workspaceId);
  const now = Date.now();

  if (row?.status === "completed" && row.completed_at) {
    const age = now - new Date(row.completed_at).getTime();
    if (age >= 0 && age < CACHE_TTL_MS) return resultFromRow(row, "cached");
  }
  if (row?.status === "pending" && row.dataforseo_task_id) {
    return resultFromRow(row, "pending");
  }
  if (row?.status === "pending" && now - new Date(row.updated_at).getTime() < STALE_PENDING_MS) {
    return resultFromRow(row, "pending");
  }
  if (row?.status === "failed" && now - new Date(row.updated_at).getTime() < RETRY_AFTER_MS) {
    return resultFromRow(row, "failed");
  }

  let created = false;
  if (row) {
    row = await updateRow(row.id, {
      status: "pending",
      dataforseo_task_id: null,
      normalized_result: null,
      provider_error: null,
      requested_at: new Date().toISOString(),
      completed_at: null,
      last_polled_at: null,
    });
  } else {
    const inserted = await createPendingRow(input, requestKey, workspaceId);
    row = inserted.row;
    created = inserted.created;
  }

  if (row.dataforseo_task_id) return resultFromRow(row, "pending");
  if (!created) return resultFromRow(row, "pending");

  try {
    const task = await createGoogleTrendsTask(input);
    row = await updateRow(row.id, {
      dataforseo_task_id: task.taskId,
      status: "pending",
      provider_error: null,
    });
    return resultFromRow(row, "pending");
  } catch (error) {
    row = await updateRow(row.id, { status: "failed", provider_error: providerError(error) });
    return { ...resultFromRow(row, "failed"), error: providerError(error) };
  }
}

export async function requestGoogleTrendsCollection(
  input: GoogleTrendsInput,
  workspaceId: string,
): Promise<TrendCollectionResult> {
  const key = `${workspaceId}:${trendRequestKey(input)}`;
  const active = inflight.get(key);
  if (active) return active;
  const work = startCollection(input, workspaceId).finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

export async function pollGoogleTrendsCollection(
  collectionId: string,
): Promise<TrendCollectionResult> {
  const row = (await supabaseAdmin
    .from("market_trend_collections")
    .select("*")
    .eq("id", collectionId)
    .maybeSingle()) as { data: CollectionRow | null; error: unknown };
  if (row.error || !row.data) return { state: "no_data", collectionId, taskId: null };
  const current = row.data;
  if (current.status === "completed") return resultFromRow(current, "completed");
  if (current.status === "failed") return resultFromRow(current, "failed");
  if (!current.dataforseo_task_id) return resultFromRow(current, "pending");

  try {
    const task = await getGoogleTrendsTask(current.dataforseo_task_id, current.keywords);
    if (task.status === "pending") {
      const updated = await updateRow(current.id, { last_polled_at: new Date().toISOString() });
      return resultFromRow(updated, "pending");
    }
    if (task.status === "failed") {
      const updated = await updateRow(current.id, {
        status: "failed",
        last_polled_at: new Date().toISOString(),
        provider_error: {
          message: task.statusMessage ?? "DataForSEO task failed",
          providerCode: task.statusCode,
        },
      });
      return resultFromRow(updated, "failed");
    }
    const updated = await updateRow(current.id, {
      status: "completed",
      last_polled_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      normalized_result: task.data ?? null,
      provider_error: null,
    });
    return resultFromRow(updated, task.data ? "completed" : "no_data");
  } catch (error) {
    const details = providerError(error);
    const updated = await updateRow(current.id, {
      status: "failed",
      last_polled_at: new Date().toISOString(),
      provider_error: details,
    });
    return { ...resultFromRow(updated, "failed"), error: details };
  }
}
