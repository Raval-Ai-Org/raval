"use client";

// Market Brain client state, kept outside React so a scan survives the panel
// unmounting (tab switch, closing the coach, maximizing it into a popup) and the
// latest result is shown instantly when the panel opens again. One entry per
// workspace; components read it through useMarketBrain().

import { useSyncExternalStore } from "react";
import type { ScanPhase } from "@/components/app/MarketBrainProgress";
import { authedFetch } from "@/lib/authed-fetch";

export type TrendPoint = {
  timestamp: number;
  date: string;
  values: number[];
  averages?: number[];
  missingData?: boolean;
};
export type TrendData = {
  keywords: string[];
  interestOverTime: TrendPoint[];
  regionalInterest: { geoId: string; geoName: string; values: number[] }[];
  relatedQueries: { query: string; value: string; kind: "top" | "rising" }[];
  relatedTopics: {
    topicId: string;
    topicTitle: string;
    topicType: string;
    value: string;
    kind: "top" | "rising";
  }[];
};
export type Priority = "high" | "medium" | "low";
export type Intelligence = {
  summary: string;
  trendSignals: {
    title: string;
    direction: "rising" | "declining" | "stable" | "mixed" | "unclear";
    evidence: string[];
    significance: string;
    opportunities: string[];
  }[];
  opportunities: {
    title: string;
    explanation: string;
    targetAudience: string;
    recommendedAction: string;
    priority: Priority;
  }[];
  recommendations: {
    action: string;
    reason: string;
    expectedMarketingImpact: string;
    priority: Priority;
  }[];
  relatedQueries: string[];
  relatedTopics: string[];
  confidence: "high" | "medium" | "low";
  generatedAt: string;
};

export type MarketLens = { keywords: string[]; location: string };

export type MarketNotice = {
  tone: "error" | "info";
  message: string;
  /** What the notice's action button does. */
  action?: "retry-scan" | "analyze";
};

export type MarketBrainSnapshot = {
  /** The first /api/market/latest load finished (successfully or not). */
  hydrated: boolean;
  running: boolean;
  phase: ScanPhase;
  startedAt: number;
  phaseStartedAt: number;
  /** The provider is still working after the client stopped polling. */
  pending: boolean;
  /** Results on screen belong to the previous scan while a new one runs. */
  staleResults: boolean;
  trendData: TrendData | null;
  intelligence: Intelligence | null;
  collectionId: string | null;
  resultLens: MarketLens | null;
  completedAt: string | null;
  freshUntil: string | null;
  nextRunAt: string | null;
  /** The latest finished scan measured no interest (and there is no older result). */
  noData: boolean;
  notice: MarketNotice | null;
};

type ApiResult = {
  state: "cached" | "pending" | "completed" | "failed" | "no_data";
  collectionId?: string | null;
  data?: TrendData;
  error?: { message?: string; code?: string };
  retryAfterSeconds?: number;
};

type LatestResponse = {
  result: {
    collectionId: string;
    keywords: string[];
    location: string | null;
    completedAt: string;
    data: TrendData | null;
  } | null;
  intelligence: Intelligence | null;
  activeScan: {
    collectionId: string;
    keywords: string[];
    location: string | null;
    requestedAt: string;
  } | null;
  lastError: { message: string; code?: string } | null;
  schedule: { nextRunAt: string | null; lastRunStatus: string | null } | null;
  freshUntil: string | null;
};

// Each scan/poll request returns quickly (the server only reads state or asks
// DataForSEO for task status), so it keeps a short bound.
const SCAN_REQUEST_TIMEOUT_MS = 20_000;
// The analysis request runs one Claude generation (~35-40s measured); the server
// bounds it at 90s and answers with a structured timeout, so wait just past that.
const INTELLIGENCE_REQUEST_TIMEOUT_MS = 95_000;
// DataForSEO's standard queue usually finishes a Google Trends task in 1-3 min.
// Keep polling (backing off) for that long; after it, the scan stays pending and
// "Check status" resumes it without creating a new provider task.
const PENDING_POLL_BUDGET_MS = 4 * 60_000;

function pollDelay(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 2_500;
  if (elapsedMs < 90_000) return 5_000;
  return 10_000;
}

export class MarketRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "MarketRequestError";
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error;
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "Market Brain could not load";
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    throw new MarketRequestError(message, response.status, code);
  }
  return body;
}

export function withDetail(prefix: string, detail?: string): string {
  return detail ? `${prefix} ${detail.replace(/\.?$/, ".")}` : `${prefix} Please try again.`;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Market scan aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function relativeTime(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const diff = now - new Date(iso).getTime();
  const future = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const label =
    mins < 1
      ? "a moment"
      : mins < 60
        ? `${mins}m`
        : mins < 60 * 24
          ? `${Math.round(mins / 60)}h`
          : `${Math.round(mins / (60 * 24))}d`;
  if (mins < 1) return future ? "in a moment" : "just now";
  return future ? `in ${label}` : `${label} ago`;
}

/* ------------------------------ store core ------------------------------ */

const EMPTY: MarketBrainSnapshot = Object.freeze({
  hydrated: false,
  running: false,
  phase: "starting",
  startedAt: 0,
  phaseStartedAt: 0,
  pending: false,
  staleResults: false,
  trendData: null,
  intelligence: null,
  collectionId: null,
  resultLens: null,
  completedAt: null,
  freshUntil: null,
  nextRunAt: null,
  noData: false,
  notice: null,
}) as MarketBrainSnapshot;

const entries = new Map<string, MarketBrainSnapshot>();
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
const hydrations = new Map<string, Promise<void>>();

function read(workspaceId: string): MarketBrainSnapshot {
  return entries.get(workspaceId) ?? EMPTY;
}

function write(workspaceId: string, patch: Partial<MarketBrainSnapshot>) {
  entries.set(workspaceId, { ...read(workspaceId), ...patch });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMarketBrain(workspaceId: string | null): MarketBrainSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => (workspaceId ? read(workspaceId) : EMPTY),
    () => EMPTY,
  );
}

export function getMarketBrainSnapshot(workspaceId: string): MarketBrainSnapshot {
  return read(workspaceId);
}

/** Test hook. */
export function resetMarketBrainStore() {
  for (const controller of controllers.values()) controller.abort();
  entries.clear();
  controllers.clear();
  hydrations.clear();
}

function lensFrom(keywords: string[], location: string | null): MarketLens {
  return { keywords, location: location ?? "" };
}

/* ------------------------------ hydration ------------------------------- */

async function fetchLatest(workspaceId: string, signal?: AbortSignal): Promise<LatestResponse> {
  const response = await authedFetch(
    `/api/market/latest?workspaceId=${encodeURIComponent(workspaceId)}`,
    { signal },
  );
  return (await readJson(response)) as unknown as LatestResponse;
}

function applyLatest(workspaceId: string, latest: LatestResponse) {
  const current = read(workspaceId);
  const result = latest.result;
  // Never replace a result this tab already holds with an older (or not yet
  // visible) server snapshot; only refresh the schedule/freshness details.
  const currentTime = current.completedAt ? new Date(current.completedAt).getTime() : 0;
  const serverTime = result ? new Date(result.completedAt).getTime() : 0;
  if (current.trendData && serverTime < currentTime) {
    write(workspaceId, {
      hydrated: true,
      freshUntil: latest.freshUntil ?? current.freshUntil,
      nextRunAt: latest.schedule?.nextRunAt ?? current.nextRunAt,
    });
    return;
  }
  write(workspaceId, {
    hydrated: true,
    trendData: result?.data ?? null,
    intelligence: result?.data ? latest.intelligence : null,
    collectionId: result?.collectionId ?? null,
    resultLens: result ? lensFrom(result.keywords, result.location) : null,
    completedAt: result?.completedAt ?? null,
    freshUntil: latest.freshUntil,
    nextRunAt: latest.schedule?.nextRunAt ?? null,
    noData: Boolean(result && !result.data),
    notice:
      latest.lastError && !current.running
        ? {
            tone: "error",
            message: result?.data
              ? withDetail(
                  "The last refresh failed — showing the previous results:",
                  latest.lastError.message,
                )
              : withDetail("The last market scan failed:", latest.lastError.message),
            action: "retry-scan",
          }
        : result?.data && !latest.intelligence
          ? {
              tone: "info",
              message: "Trend data is ready. Ravi hasn't analyzed it yet.",
              action: "analyze",
            }
          : current.notice,
  });
}

/**
 * Load the stored latest result (free: no provider calls). Resumes a scan that
 * was still running when the panel closed. Safe to call on every mount.
 */
export function hydrateMarketBrain(workspaceId: string): Promise<void> {
  const inFlight = hydrations.get(workspaceId);
  if (inFlight) return inFlight;
  const work = (async () => {
    try {
      const latest = await fetchLatest(workspaceId);
      // A scan started in this tab owns the state; don't overwrite it mid-run.
      if (read(workspaceId).running) return;
      applyLatest(workspaceId, latest);
      if (latest.activeScan) {
        void resumeMarketScan(
          workspaceId,
          latest.activeScan.collectionId,
          lensFrom(latest.activeScan.keywords, latest.activeScan.location),
        );
      }
    } catch {
      // Nothing stored yet, offline, or not signed in: the setup form covers it.
      write(workspaceId, { hydrated: true });
    }
  })().finally(() => hydrations.delete(workspaceId));
  hydrations.set(workspaceId, work);
  return work;
}

/* ------------------------------ scanning -------------------------------- */

type RunContext = {
  workspaceId: string;
  controller: AbortController;
  isCurrent: () => boolean;
  fetchJson: (
    input: string,
    init?: RequestInit,
    timeoutMs?: number,
  ) => Promise<Record<string, unknown>>;
  enterPhase: (phase: ScanPhase) => void;
};

function beginRun(workspaceId: string, phase: ScanPhase): RunContext {
  controllers.get(workspaceId)?.abort();
  const controller = new AbortController();
  controllers.set(workspaceId, controller);
  const current = read(workspaceId);
  const now = Date.now();
  write(workspaceId, {
    hydrated: true,
    running: true,
    pending: false,
    phase,
    startedAt: now,
    phaseStartedAt: now,
    staleResults: Boolean(current.trendData || current.intelligence),
    notice: null,
  });
  return {
    workspaceId,
    controller,
    isCurrent: () => controllers.get(workspaceId) === controller,
    fetchJson: async (input, init = {}, timeoutMs = SCAN_REQUEST_TIMEOUT_MS) => {
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await readJson(await authedFetch(input, { ...init, signal: controller.signal }));
      } finally {
        clearTimeout(timeout);
      }
    },
    enterPhase: (next) => write(workspaceId, { phase: next, phaseStartedAt: Date.now() }),
  };
}

function endRun(run: RunContext, patch: Partial<MarketBrainSnapshot>) {
  if (!run.isCurrent()) return;
  controllers.delete(run.workspaceId);
  write(run.workspaceId, { running: false, staleResults: false, ...patch });
}

function failRun(run: RunContext, cause: unknown) {
  if (!run.isCurrent()) return;
  const hasResult = Boolean(read(run.workspaceId).trendData);
  const reason =
    cause instanceof DOMException && cause.name === "AbortError"
      ? "Market scan timed out. Please try again."
      : cause instanceof MarketRequestError
        ? withDetail("Market scan couldn't be completed:", cause.message)
        : "Market scan couldn't be completed. Please try again.";
  endRun(run, {
    notice: {
      tone: "error",
      message: hasResult ? `${reason} Showing your previous results.` : reason,
      action: "retry-scan",
    },
  });
}

async function followCollection(
  run: RunContext,
  collectionId: string,
  initial: ApiResult,
  lens: MarketLens,
) {
  let collection = initial;
  const pollStartedAt = Date.now();
  while (collection.state === "pending" && Date.now() - pollStartedAt < PENDING_POLL_BUDGET_MS) {
    await sleep(pollDelay(Date.now() - pollStartedAt), run.controller.signal);
    if (!run.isCurrent()) return;
    collection = (await run.fetchJson(
      `/api/market/trends?collectionId=${encodeURIComponent(collectionId)}&workspaceId=${encodeURIComponent(run.workspaceId)}`,
    )) as ApiResult;
  }
  if (!run.isCurrent()) return;
  const hasResult = Boolean(read(run.workspaceId).trendData);

  if (collection.state === "pending") {
    pendingCollections.set(run.workspaceId, { collectionId, lens });
    endRun(run, { pending: true });
    return;
  }
  if (collection.state === "failed") {
    endRun(run, {
      notice: {
        tone: "error",
        message:
          withDetail(
            "Google Trends collection failed:",
            collection.retryAfterSeconds
              ? `${collection.error?.message ?? "unknown error"} — retry available in ${collection.retryAfterSeconds}s`
              : collection.error?.message,
          ) + (hasResult ? " Showing your previous results." : ""),
        action: "retry-scan",
      },
    });
    return;
  }
  if (collection.state === "no_data") {
    const message = `Google Trends found no measurable search interest for “${lens.keywords.join(", ")}” in ${lens.location}. Try broader keywords or another market.`;
    // A previous result is still the latest measured data: keep showing it.
    endRun(run, { noData: !hasResult, notice: { tone: "info", message } });
    return;
  }

  // Fresh trend data replaces the previous scan's result right away; its
  // analysis follows (the old analysis belongs to the old data).
  write(run.workspaceId, {
    trendData: collection.data ?? null,
    intelligence: null,
    collectionId,
    resultLens: lens,
    completedAt: new Date().toISOString(),
    staleResults: false,
    noData: false,
  });
  await analyze(run, collectionId);
}

async function analyze(run: RunContext, collectionId: string) {
  run.enterPhase("analyzing");
  const analysis = (await run.fetchJson(
    "/api/market/intelligence",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: run.workspaceId,
        collectionId,
        analysisType: "market_strategy",
      }),
    },
    INTELLIGENCE_REQUEST_TIMEOUT_MS,
  )) as ApiResult & { data?: Intelligence };
  if (!run.isCurrent()) return;
  if (analysis.data) {
    endRun(run, { intelligence: analysis.data, notice: null });
    // Sync completedAt / freshUntil / next scheduled run with the server.
    void fetchLatest(run.workspaceId)
      .then((latest) => {
        if (read(run.workspaceId).running) return;
        write(run.workspaceId, {
          completedAt: latest.result?.completedAt ?? read(run.workspaceId).completedAt,
          freshUntil: latest.freshUntil,
          nextRunAt: latest.schedule?.nextRunAt ?? null,
        });
      })
      .catch(() => {});
    return;
  }
  endRun(run, {
    notice: {
      tone: "error",
      message:
        analysis.state === "failed"
          ? withDetail("Trend data is ready, but Ravi's analysis failed:", analysis.error?.message)
          : "No market data is available to analyze for this scan.",
      action: "analyze",
    },
  });
}

const pendingCollections = new Map<string, { collectionId: string; lens: MarketLens }>();

/** Start (or refresh) a scan for the lens. Cached data is reused server-side. */
export async function startMarketScan(workspaceId: string, lens: MarketLens): Promise<void> {
  const run = beginRun(workspaceId, "starting");
  pendingCollections.delete(workspaceId);
  try {
    const started = (await run.fetchJson("/api/market/trends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        keywords: lens.keywords,
        location: lens.location,
        language: "en",
      }),
    })) as ApiResult;
    if (!run.isCurrent()) return;
    if (!started.collectionId) throw new Error("Market collection could not be started");
    if (started.state === "pending") run.enterPhase("collecting");
    await followCollection(run, started.collectionId, started, lens);
  } catch (cause) {
    failRun(run, cause);
  }
}

/** Keep following a collection that is already running (no new provider task). */
export async function resumeMarketScan(
  workspaceId: string,
  collectionId: string,
  lens: MarketLens,
): Promise<void> {
  const run = beginRun(workspaceId, "collecting");
  pendingCollections.delete(workspaceId);
  try {
    await followCollection(run, collectionId, { state: "pending", collectionId }, lens);
  } catch (cause) {
    failRun(run, cause);
  }
}

/** "Check status" on a scan that outlived the polling window. */
export function checkPendingScan(workspaceId: string, fallbackLens: MarketLens): Promise<void> {
  const pending = pendingCollections.get(workspaceId);
  return pending
    ? resumeMarketScan(workspaceId, pending.collectionId, pending.lens)
    : startMarketScan(workspaceId, fallbackLens);
}

/** Generate (or fetch the cached) analysis for the current trend data. */
export async function analyzeCurrentResult(workspaceId: string): Promise<void> {
  const collectionId = read(workspaceId).collectionId;
  if (!collectionId) return;
  const run = beginRun(workspaceId, "analyzing");
  write(workspaceId, { staleResults: false });
  try {
    await analyze(run, collectionId);
  } catch (cause) {
    failRun(run, cause);
  }
}
