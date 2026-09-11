import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesUpdate } from "@/integrations/supabase/types";
import {
  createGoogleTrendsTask,
  DataForSeoError,
  getGoogleTrendsTask,
  hasTrendSignal,
  type GoogleTrendsData,
  type GoogleTrendsInput,
} from "@/lib/dataforseo/google-trends.server";
import { marketLog, withMarketTimeout } from "@/lib/market-reliability.server";

export type TrendCollectionState = "cached" | "pending" | "completed" | "failed" | "no_data";

export type TrendCollectionError = {
  message: string;
  status?: number;
  providerCode?: number;
  code?: string;
};

export type TrendCollectionResult = {
  state: TrendCollectionState;
  collectionId: string | null;
  taskId: string | null;
  data?: GoogleTrendsData;
  error?: TrendCollectionError;
  /** Set on a failed result still inside the retry cooldown. */
  retryAfterSeconds?: number;
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
  // The table's CHECK constraint allows exactly these three values. "No data" is
  // persisted as completed + normalized_result null + provider_error.code
  // "no_data", and surfaced to callers as the no_data state.
  status: "pending" | "completed" | "failed";
  normalized_result: unknown;
  provider_error: unknown;
  requested_at: string;
  last_polled_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 1000;
// A DataForSEO standard-queue Google Trends task normally finishes in 1-3 minutes.
// Past this age (from requested_at, which polling does not touch) it is abandoned.
const STALE_PENDING_MS = 20 * 60 * 1000;
// A pending row with no task id after this long means task creation never finished.
const TASK_CREATION_GRACE_MS = 2 * 60 * 1000;
const NO_DATA_ERROR: TrendCollectionError = {
  message: "Google Trends returned no measurable search interest for these keywords.",
  code: "no_data",
};
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

function ageMs(timestamp: string | null, now = Date.now()): number {
  return timestamp ? now - new Date(timestamp).getTime() : Number.POSITIVE_INFINITY;
}

function rowError(row: CollectionRow): TrendCollectionError | undefined {
  return row.provider_error && typeof row.provider_error === "object"
    ? (row.provider_error as TrendCollectionError)
    : undefined;
}

function resultFromRow(row: CollectionRow, state: TrendCollectionState): TrendCollectionResult {
  const data = row.normalized_result as GoogleTrendsData | null;
  const error = rowError(row);
  return {
    state: data ? state : state === "cached" || state === "completed" ? "no_data" : state,
    collectionId: row.id,
    taskId: row.dataforseo_task_id,
    ...(data ? { data } : {}),
    ...(error ? { error } : {}),
  };
}

function providerError(error: unknown): TrendCollectionError {
  if (error instanceof DataForSeoError) {
    return { message: error.message, status: error.status, providerCode: error.code };
  }
  return { message: "Google Trends collection failed", status: 502 };
}

async function getRow(
  requestKey: string,
  workspaceId: string,
  operation = "unknown",
): Promise<CollectionRow | null> {
  const query = supabaseAdmin
    .from("market_trend_collections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("request_key", requestKey);
  const { data, error } = await withMarketTimeout(
    query.maybeSingle(),
    undefined,
    "Market collection lookup timed out",
  );
  if (error) {
    marketLog("collection lookup failed", { operation, code: error.code, message: error.message });
    throw new Error("Failed to read Google Trends cache");
  }
  marketLog("collection lookup", { operation, found: Boolean(data), status: data?.status });
  return data as CollectionRow | null;
}

async function updateRow(
  id: string,
  values: TablesUpdate<"market_trend_collections">,
  operation = "unknown",
): Promise<CollectionRow> {
  const query = supabaseAdmin
    .from("market_trend_collections")
    .update(values)
    .eq("id", id)
    .select("*");
  const { data, error } = await withMarketTimeout(
    query.single(),
    undefined,
    "Market collection update timed out",
  );
  if (error || !data) {
    marketLog("collection update failed", {
      operation,
      collectionId: id,
      status: values.status,
      code: error?.code,
      message: error?.message,
    });
    throw new Error("Failed to update Google Trends collection");
  }
  marketLog("collection updated", { operation, collectionId: id, status: values.status });
  return data as CollectionRow;
}

/**
 * Reset an expired/failed/stale row to pending, but only if nobody else changed
 * it since we read it (compare-and-set on updated_at). Returns null when another
 * request won the race — that request owns task creation, so we must not create
 * a second billed DataForSEO task.
 */
async function claimRow(row: CollectionRow, operation: string): Promise<CollectionRow | null> {
  const query = supabaseAdmin
    .from("market_trend_collections")
    .update({
      status: "pending",
      dataforseo_task_id: null,
      normalized_result: null,
      provider_error: null,
      requested_at: new Date().toISOString(),
      completed_at: null,
      last_polled_at: null,
    })
    .eq("id", row.id)
    .eq("updated_at", row.updated_at)
    .select("*");
  const { data, error } = await withMarketTimeout(
    query.maybeSingle(),
    undefined,
    "Market collection update timed out",
  );
  if (error) {
    marketLog("collection claim failed", {
      operation,
      collectionId: row.id,
      message: error.message,
    });
    throw new Error("Failed to update Google Trends collection");
  }
  marketLog(data ? "collection claimed" : "collection claim lost to concurrent request", {
    operation,
    collectionId: row.id,
  });
  return (data as CollectionRow | null) ?? null;
}

async function createPendingRow(
  input: GoogleTrendsInput,
  requestKey: string,
  workspaceId: string,
  operation = "unknown",
): Promise<{ row: CollectionRow; created: boolean }> {
  const query = supabaseAdmin
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
    .select("*");
  const { data, error } = await withMarketTimeout(
    query.single(),
    undefined,
    "Market collection creation timed out",
  );
  if (!error && data) {
    marketLog("collection created", { operation, collectionId: data.id });
    return { row: data as CollectionRow, created: true };
  }
  // Unique (workspace_id, request_key): a concurrent request inserted first.
  const existing = await getRow(requestKey, workspaceId, operation);
  if (existing) return { row: existing, created: false };
  marketLog("collection creation failed", {
    operation,
    code: error?.code,
    message: error?.message,
  });
  throw new Error("Failed to create Google Trends collection");
}

async function startCollection(
  input: GoogleTrendsInput,
  workspaceId: string,
  operation: string,
): Promise<TrendCollectionResult> {
  const requestKey = trendRequestKey(input);
  marketLog("collection start", { operation, requestKey });
  let row = await getRow(requestKey, workspaceId, operation);
  const now = Date.now();

  if (row?.status === "completed") {
    const age = ageMs(row.completed_at, now);
    if (age >= 0 && age < CACHE_TTL_MS) return resultFromRow(row, "cached");
  }
  if (row?.status === "pending") {
    if (ageMs(row.requested_at, now) < STALE_PENDING_MS) {
      marketLog("pending collection reused", {
        operation,
        collectionId: row.id,
        hasTask: Boolean(row.dataforseo_task_id),
      });
      return resultFromRow(row, "pending");
    }
    marketLog("stale pending collection reclaimed", { operation, collectionId: row.id });
  }
  if (row?.status === "failed") {
    const age = ageMs(row.updated_at, now);
    if (age < RETRY_AFTER_MS) {
      return {
        ...resultFromRow(row, "failed"),
        retryAfterSeconds: Math.max(1, Math.ceil((RETRY_AFTER_MS - age) / 1000)),
      };
    }
  }

  if (row) {
    const claimed = await claimRow(row, operation);
    if (!claimed) {
      const latest = await getRow(requestKey, workspaceId, operation);
      return latest
        ? resultFromRow(latest, latest.status === "completed" ? "cached" : latest.status)
        : { state: "pending", collectionId: row.id, taskId: null };
    }
    row = claimed;
  } else {
    const inserted = await createPendingRow(input, requestKey, workspaceId, operation);
    row = inserted.row;
    // Another request inserted the row and owns task creation.
    if (!inserted.created) {
      return resultFromRow(row, row.status === "completed" ? "cached" : row.status);
    }
  }

  try {
    const task = await createGoogleTrendsTask(input);
    row = await updateRow(
      row.id,
      { dataforseo_task_id: task.taskId, status: "pending", provider_error: null },
      operation,
    );
    marketLog("DataForSEO task created", { operation, collectionId: row.id, taskId: task.taskId });
    return resultFromRow(row, "pending");
  } catch (error) {
    const details = providerError(error);
    marketLog("DataForSEO task creation failed", {
      operation,
      collectionId: row.id,
      message: details.message,
      providerCode: details.providerCode,
    });
    row = await updateRow(row.id, { status: "failed", provider_error: details }, operation);
    return { ...resultFromRow(row, "failed"), error: details };
  }
}

export async function requestGoogleTrendsCollection(
  input: GoogleTrendsInput,
  workspaceId: string,
  operation = "unknown",
): Promise<TrendCollectionResult> {
  const key = `${workspaceId}:${trendRequestKey(input)}`;
  const active = inflight.get(key);
  if (active) return active;
  const work = startCollection(input, workspaceId, operation).finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

async function failRow(
  row: CollectionRow,
  error: TrendCollectionError,
  operation: string,
): Promise<TrendCollectionResult> {
  const updated = await updateRow(
    row.id,
    { status: "failed", last_polled_at: new Date().toISOString(), provider_error: error },
    operation,
  );
  return { ...resultFromRow(updated, "failed"), error };
}

export async function pollGoogleTrendsCollection(
  collectionId: string,
  operation = "unknown",
): Promise<TrendCollectionResult> {
  const query = supabaseAdmin.from("market_trend_collections").select("*").eq("id", collectionId);
  const row = (await withMarketTimeout(
    query.maybeSingle(),
    undefined,
    "Market collection read timed out",
  )) as { data: CollectionRow | null; error: { message?: string } | null };
  if (row.error) {
    marketLog("collection read failed", { operation, collectionId, message: row.error.message });
    throw new Error("Failed to read Google Trends collection");
  }
  if (!row.data) return { state: "no_data", collectionId, taskId: null };
  const current = row.data;
  marketLog("DataForSEO polling started", {
    operation,
    collectionId,
    taskId: current.dataforseo_task_id,
    status: current.status,
  });
  if (current.status === "completed") return resultFromRow(current, "completed");
  if (current.status === "failed") return resultFromRow(current, "failed");

  const pendingAge = ageMs(current.requested_at);
  if (!current.dataforseo_task_id) {
    if (pendingAge < TASK_CREATION_GRACE_MS) return resultFromRow(current, "pending");
    marketLog("collection has no provider task; failing", { operation, collectionId });
    return failRow(
      current,
      {
        message: "The Google Trends task was never created. Please retry.",
        code: "task_not_created",
      },
      operation,
    );
  }

  try {
    const task = await getGoogleTrendsTask(current.dataforseo_task_id, current.keywords);
    marketLog("DataForSEO polling result", {
      operation,
      collectionId,
      taskId: current.dataforseo_task_id,
      status: task.status,
      statusCode: task.statusCode,
      statusMessage: task.statusMessage,
    });
    if (task.status === "pending") {
      if (pendingAge >= STALE_PENDING_MS) {
        return failRow(
          current,
          {
            message: "Google Trends did not finish collecting in time. Please retry.",
            providerCode: task.statusCode,
            code: "provider_timeout",
          },
          operation,
        );
      }
      const updated = await updateRow(
        current.id,
        { last_polled_at: new Date().toISOString() },
        operation,
      );
      return resultFromRow(updated, "pending");
    }
    if (task.status === "failed") {
      return failRow(
        current,
        {
          message: task.statusMessage ?? "DataForSEO task failed",
          providerCode: task.statusCode,
        },
        operation,
      );
    }
    const data = task.data && hasTrendSignal(task.data) ? task.data : null;
    const updated = await updateRow(
      current.id,
      {
        status: "completed",
        last_polled_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        normalized_result: data,
        provider_error: data ? null : NO_DATA_ERROR,
      },
      operation,
    );
    marketLog(data ? "DataForSEO completed" : "DataForSEO completed without data", {
      operation,
      collectionId,
      points: data?.interestOverTime.length ?? 0,
      regions: data?.regionalInterest.length ?? 0,
    });
    return resultFromRow(updated, data ? "completed" : "no_data");
  } catch (error) {
    const details = providerError(error);
    const transient = error instanceof DataForSeoError && error.transient;
    marketLog("DataForSEO polling failed", {
      operation,
      collectionId,
      transient,
      message: details.message,
      providerCode: details.providerCode,
    });
    // A timeout or 5xx while checking status says nothing about the task itself:
    // stay pending (bounded by STALE_PENDING_MS) instead of discarding it.
    if (transient && pendingAge < STALE_PENDING_MS) {
      return { ...resultFromRow(current, "pending"), error: details };
    }
    return failRow(current, details, operation);
  }
}
