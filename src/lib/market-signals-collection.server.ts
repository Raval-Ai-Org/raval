import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesUpdate } from "@/integrations/supabase/types";
import {
  collectMarketSignals,
  hasMarketSignal,
  type MarketSignalsData,
  type MarketSignalsInput,
} from "@/server/research/market-signals.server";
import { marketLog, withMarketTimeout } from "@/lib/market-reliability.server";
import { BudgetExceededError, enforceBudget } from "@/server/ai/budget";

// The Market Brain collection/cache layer. Google Trends via DataForSEO was an
// async provider — create a task, then poll it for 1-3 minutes. Tavily search
// answers inside the request, so unlike the DataForSEO-era version of this
// file there is no task id and no polling loop: requestMarketSignalsCollection
// does the whole search inline and returns "completed" (or "failed"/"no_data")
// directly in the common case. "pending" is now only a crash-recovery state —
// a row left behind by a request that never finished — not a normal phase of
// every scan. pollMarketSignalsCollection stays for that case, and because a
// second browser tab can still be mid-request when this one asks.

export type SignalCollectionState = "cached" | "pending" | "completed" | "failed" | "no_data";

export type SignalCollectionError = {
  message: string;
  status?: number;
  code?: string;
};

export type SignalCollectionResult = {
  state: SignalCollectionState;
  collectionId: string | null;
  data?: MarketSignalsData;
  error?: SignalCollectionError;
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
  status: "pending" | "completed" | "failed";
  normalized_result: unknown;
  provider_error: unknown;
  requested_at: string;
  completed_at: string | null;
  updated_at: string;
};

/** How long a completed collection is reused before a scan searches again. */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 1000;
// A search resolves within one request; a row still "pending" this long after
// being requested means the request that owned it crashed or was killed.
export const STALE_PENDING_MS = 2 * 60 * 1000;
const NO_DATA_ERROR: SignalCollectionError = {
  message: "No recent web coverage was found for these keywords.",
  code: "no_data",
};
const inflight = new Map<string, Promise<SignalCollectionResult>>();

function canonicalInput(input: MarketSignalsInput): string {
  return JSON.stringify({
    keywords: input.keywords.map((keyword) => keyword.trim()).filter(Boolean),
    location: input.location?.trim() || null,
  });
}

export function marketSignalsRequestKey(input: MarketSignalsInput): string {
  return createHash("sha256").update(canonicalInput(input)).digest("hex");
}

function ageMs(timestamp: string | null, now = Date.now()): number {
  return timestamp ? now - new Date(timestamp).getTime() : Number.POSITIVE_INFINITY;
}

function rowError(row: CollectionRow): SignalCollectionError | undefined {
  return row.provider_error && typeof row.provider_error === "object"
    ? (row.provider_error as SignalCollectionError)
    : undefined;
}

function resultFromRow(row: CollectionRow, state: SignalCollectionState): SignalCollectionResult {
  // A pending or failed row can still hold the previous scan's data (kept so
  // the last good result stays readable); it is never returned as this scan's.
  const data =
    state === "cached" || state === "completed"
      ? (row.normalized_result as MarketSignalsData | null)
      : null;
  const error = rowError(row);
  return {
    state: data ? state : state === "cached" || state === "completed" ? "no_data" : state,
    collectionId: row.id,
    ...(data ? { data } : {}),
    ...(error ? { error } : {}),
  };
}

function providerError(error: unknown): SignalCollectionError {
  if (error instanceof Error) return { message: error.message };
  return { message: "Market signal collection failed", status: 502 };
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
    throw new Error("Failed to read market signals cache");
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
    throw new Error("Failed to update market signals collection");
  }
  marketLog("collection updated", { operation, collectionId: id, status: values.status });
  return data as CollectionRow;
}

/**
 * Reset an expired/failed/stale row to pending, but only if nobody else changed
 * it since we read it (compare-and-set on updated_at). Returns null when another
 * request won the race — that request owns the search, so we must not run (and
 * bill) a second one.
 *
 * normalized_result and completed_at are deliberately kept: the previous good
 * result stays available (GET /api/market/latest) until this scan replaces it.
 */
async function claimRow(row: CollectionRow, operation: string): Promise<CollectionRow | null> {
  const query = supabaseAdmin
    .from("market_trend_collections")
    .update({
      status: "pending",
      provider_error: null,
      requested_at: new Date().toISOString(),
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
    throw new Error("Failed to update market signals collection");
  }
  marketLog(data ? "collection claimed" : "collection claim lost to concurrent request", {
    operation,
    collectionId: row.id,
  });
  return (data as CollectionRow | null) ?? null;
}

async function createPendingRow(
  input: MarketSignalsInput,
  requestKey: string,
  workspaceId: string,
  operation = "unknown",
): Promise<{ row: CollectionRow; created: boolean }> {
  const query = supabaseAdmin
    .from("market_trend_collections")
    .insert({
      workspace_id: workspaceId,
      request_key: requestKey,
      provider: "tavily",
      keywords: input.keywords,
      location: input.location ?? null,
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
  throw new Error("Failed to create market signals collection");
}

async function runCollection(
  row: CollectionRow,
  input: MarketSignalsInput,
  operation: string,
): Promise<SignalCollectionResult> {
  try {
    // A new search is billed — the workspace's plan must allow it.
    await enforceBudget("search", { workspaceId: row.workspace_id });
    const data = await collectMarketSignals(input, { route: operation });
    const found = hasMarketSignal(data);
    const updated = await updateRow(
      row.id,
      {
        status: "completed",
        completed_at: new Date().toISOString(),
        normalized_result: found ? data : null,
        provider_error: found ? null : NO_DATA_ERROR,
      },
      operation,
    );
    marketLog(found ? "market signals collected" : "market signals collected without data", {
      operation,
      collectionId: row.id,
      sources: data.sources.length,
    });
    return resultFromRow(updated, found ? "completed" : "no_data");
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      await updateRow(
        row.id,
        { status: "failed", provider_error: { message: error.message } },
        operation,
      ).catch(() => {});
      throw error;
    }
    const details = providerError(error);
    marketLog("market signal collection failed", {
      operation,
      collectionId: row.id,
      message: details.message,
    });
    const updated = await updateRow(
      row.id,
      { status: "failed", provider_error: details },
      operation,
    );
    return { ...resultFromRow(updated, "failed"), error: details };
  }
}

async function startCollection(
  input: MarketSignalsInput,
  workspaceId: string,
  operation: string,
): Promise<SignalCollectionResult> {
  const requestKey = marketSignalsRequestKey(input);
  marketLog("collection start", { operation, requestKey });
  let row = await getRow(requestKey, workspaceId, operation);
  const now = Date.now();

  if (row?.status === "completed") {
    const age = ageMs(row.completed_at, now);
    if (age >= 0 && age < CACHE_TTL_MS) return resultFromRow(row, "cached");
  }
  if (row?.status === "pending") {
    if (ageMs(row.requested_at, now) < STALE_PENDING_MS) {
      marketLog("pending collection reused", { operation, collectionId: row.id });
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
        : { state: "pending", collectionId: row.id };
    }
    row = claimed;
  } else {
    const inserted = await createPendingRow(input, requestKey, workspaceId, operation);
    row = inserted.row;
    // Another request inserted the row and owns the search.
    if (!inserted.created) {
      return resultFromRow(row, row.status === "completed" ? "cached" : row.status);
    }
  }

  return runCollection(row, input, operation);
}

export async function requestMarketSignalsCollection(
  input: MarketSignalsInput,
  workspaceId: string,
  operation = "unknown",
): Promise<SignalCollectionResult> {
  const key = `${workspaceId}:${marketSignalsRequestKey(input)}`;
  const active = inflight.get(key);
  if (active) return active;
  const work = startCollection(input, workspaceId, operation).finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

/**
 * Re-read a collection's current state. In normal operation the POST above
 * already resolved it; this exists for the crash-recovery "pending" case and
 * so a second tab can see a scan another tab started finish.
 */
export async function pollMarketSignalsCollection(
  collectionId: string,
  workspaceId: string,
  operation = "unknown",
): Promise<SignalCollectionResult> {
  // Scoped to the caller's workspace: a collection id alone must not expose
  // another workspace's data.
  const query = supabaseAdmin
    .from("market_trend_collections")
    .select("*")
    .eq("id", collectionId)
    .eq("workspace_id", workspaceId);
  const { data, error } = await withMarketTimeout(
    query.maybeSingle(),
    undefined,
    "Market collection read timed out",
  );
  if (error) {
    marketLog("collection read failed", { operation, collectionId, message: error.message });
    throw new Error("Failed to read market signals collection");
  }
  if (!data) return { state: "no_data", collectionId: null };
  const row = data as CollectionRow;
  if (row.status === "completed") return resultFromRow(row, "completed");
  if (row.status === "failed") return resultFromRow(row, "failed");

  if (ageMs(row.requested_at) >= STALE_PENDING_MS) {
    const updated = await updateRow(
      row.id,
      {
        status: "failed",
        provider_error: {
          message: "The market scan did not finish. Please retry.",
          code: "provider_timeout",
        },
      },
      operation,
    );
    return { ...resultFromRow(updated, "failed"), error: rowError(updated) };
  }
  return resultFromRow(row, "pending");
}
