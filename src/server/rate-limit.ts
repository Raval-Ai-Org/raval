// rate-limit.ts — per-user spend controls for the metered AI endpoints.
//
// Every route under /api that calls OpenRouter, Anthropic, KIE or Tavily
// bills real money per call. Authentication alone does not bound that: one
// signed-up user could previously loop /api/generate-video (Veo 3.1, billed per
// video) all night. This module is the volume cap that sits next to the
// gateway's existing per-call cost discipline (token ceilings, response cache,
// in-flight dedupe in ai-gateway.server.ts).
//
// Storage is Postgres (supabase/migrations/20260911000000_add_api_rate_limits.sql),
// not an in-process Map, because the app can run more than one instance and
// module state resets on deploy.
//
// FAIL-OPEN by design: if the limiter's own query fails, the request proceeds.
// A database hiccup must not take down the product. The tradeoff is that a
// database outage also suspends spend control — acceptable, because the outage
// already breaks the features doing the spending.

import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError } from "@/server/api-auth";
import { createMiddleware } from "@/server/middleware";

/**
 * Cost tiers, ordered roughly by what a single call bills upstream.
 * `share-password` is the odd one out: it guards an unauthenticated brute-force
 * surface rather than a metered upstream, but the mechanism is identical.
 */
export type RateLimitTier =
  | "chat"
  | "generate"
  | "audit"
  | "geo-scan"
  | "connector"
  | "connector-connect"
  | "connector-complete"
  | "connector-write"
  | "geo-fix"
  | "geo-fix-batch"
  | "geo-verify"
  | "geo-agent"
  | "geo-agent-action"
  | "image"
  | "video"
  | "ugc-draft"
  | "ugc-render"
  | "share-password"
  | "workspace-lifecycle"
  | "firecrawl"
  | "web-research"
  | "competitor-discovery"
  | "competitor-profile"
  | "analytics"
  | "analytics-sync"
  | "analytics-insights"
  | "backlinks"
  | "backlinks-verify"
  | "links-browse"
  | "links-match"
  | "links-brief"
  | "links-checkout"
  | "billing-checkout"
  | "experiment-propose"
  | "experiment-action";

type TierConfig = { limit: number; windowSeconds: number; label: string };

// Tuned to sit well above normal interactive use and well below what a script
// can spend. Raise deliberately; these are cost controls, not UX knobs.
const TIERS: Record<RateLimitTier, TierConfig> = {
  // Conversational — bursty by nature, cheap per call.
  chat: { limit: 60, windowSeconds: 60, label: "chat" },
  // Short text generations (ad copy, social posts, clarify, suggestions).
  generate: { limit: 40, windowSeconds: 60, label: "generation" },
  // Slow, crawl-backed, multi-model analyses (GEO audit, Brand DNA, Market
  // Brain). A human runs a handful an hour, not twenty a minute.
  audit: { limit: 20, windowSeconds: 300, label: "analysis" },
  // Full-site AI Visibility crawls: each fetches up to the plan's page cap.
  "geo-scan": { limit: 12, windowSeconds: 3600, label: "site scan" },
  // Connector calls that hit a provider API (GitHub repository listing,
  // verification, inspection). Protects the shared per-installation GitHub quota.
  connector: { limit: 30, windowSeconds: 60, label: "integration" },
  // Starting or completing a connection (install state issuance).
  "connector-connect": { limit: 10, windowSeconds: 600, label: "connection attempt" },
  // Completing a connection on return from the provider. Separate from starting
  // one so a few retries of a failed return don't lock the user out of starting over.
  "connector-complete": { limit: 20, windowSeconds: 600, label: "connection completion" },
  // Writes to a connected repository (branch + commit + pull request), and
  // disconnect/remove actions. Each is audited; a person approves every one.
  "connector-write": { limit: 10, windowSeconds: 600, label: "repository change" },
  // Proposed fixes for AI Visibility findings: a paid model call per proposal.
  "geo-fix": { limit: 20, windowSeconds: 3600, label: "fix proposal" },
  // "Fix all": up to 15 model calls per run.
  "geo-fix-batch": { limit: 4, windowSeconds: 3600, label: "fix-all run" },
  // Verification rescans of a few pages each.
  "geo-verify": { limit: 20, windowSeconds: 3600, label: "verification scan" },
  // GEO coding agent runs: a multi-turn model investigation (capped per run in
  // dollars too — GEO_AGENT_MAX_COST_USD).
  "geo-agent": { limit: 10, windowSeconds: 3600, label: "GEO agent run" },
  // Plan approvals, revisions and inputs — each may trigger more model turns.
  "geo-agent-action": { limit: 40, windowSeconds: 3600, label: "GEO agent action" },
  // Billed per image.
  image: { limit: 30, windowSeconds: 3600, label: "image generation" },
  // Billed per video, and the most expensive call in the product.
  video: { limit: 8, windowSeconds: 3600, label: "video generation" },
  // UGC ad drafting: product extraction, concepts and script rewrites (paid
  // model calls, but a person iterates on one ad several times).
  "ugc-draft": { limit: 40, windowSeconds: 3600, label: "ad concept" },
  // UGC video renders. Spend is bounded by allowance reservations; this caps bursts.
  "ugc-render": { limit: 12, windowSeconds: 3600, label: "video ad render" },
  // Client-share password attempts, keyed by slug. A real client mistypes a
  // password two or three times; 10 per 5 minutes is generous for them and
  // useless for a brute-force run.
  "share-password": { limit: 10, windowSeconds: 300, label: "password attempt" },
  // Creating and deleting workspaces. Retries of one create replay its
  // idempotency key, so this only bounds genuinely new workspaces and deletes.
  "workspace-lifecycle": { limit: 20, windowSeconds: 600, label: "workspace change" },
  // Firecrawl-backed crawls (competitor intelligence): a multi-page crawl plus
  // a model synthesis call, run synchronously within the request.
  firecrawl: { limit: 10, windowSeconds: 3600, label: "competitor crawl" },
  // Ad-hoc web research (chat grounding, Studio research briefs). One Tavily
  // search each, heavily cached, so this bounds a script rather than a person.
  "web-research": { limit: 30, windowSeconds: 3600, label: "web research" },
  // Competitor discovery: several searches plus a classification model call.
  // Deliberately tight — a workspace discovers its market once, not hourly.
  "competitor-discovery": { limit: 6, windowSeconds: 3600, label: "competitor discovery" },
  // Profiling or re-checking one competitor: page fetches plus a synthesis call.
  "competitor-profile": { limit: 20, windowSeconds: 3600, label: "competitor research" },
  // Analytics reports: database reads, plus an occasional Google Data API call
  // to fill the GA4 users cache for a custom range.
  analytics: { limit: 60, windowSeconds: 60, label: "analytics report" },
  // "Sync now": each run spends the property's Google API quota.
  "analytics-sync": { limit: 6, windowSeconds: 3600, label: "analytics sync" },
  // AI insights refresh — one metered model call per new set of changes.
  "analytics-insights": { limit: 10, windowSeconds: 3600, label: "insight refresh" },
  // Reading a stored backlink report — no provider call, so this is generous.
  backlinks: { limit: 60, windowSeconds: 60, label: "backlink report" },
  // Link checks fetch third-party pages from our IP; keep the footprint small.
  "backlinks-verify": { limit: 60, windowSeconds: 3600, label: "link check" },
  // Browsing the mirrored placement catalog — a database read.
  "links-browse": { limit: 90, windowSeconds: 60, label: "placement search" },
  // Each match run reads up to two dozen third-party pages and spends model
  // calls to judge them, so it is the real cost control on discovery.
  "links-match": { limit: 20, windowSeconds: 3600, label: "placement match" },
  // Writing or rewriting the article brief spends a model call.
  "links-brief": { limit: 30, windowSeconds: 3600, label: "article brief" },
  // Checkout commits credits and starts a provider cycle. Tight on purpose:
  // a user has no legitimate reason to place many orders a minute.
  "links-checkout": { limit: 10, windowSeconds: 3600, label: "placement order" },
  // Opening a Stripe checkout session.
  "billing-checkout": { limit: 10, windowSeconds: 3600, label: "credit purchase" },
  // Proof Engine: change proposals and per-page copy — paid model calls.
  "experiment-propose": { limit: 10, windowSeconds: 3600, label: "experiment proposal" },
  // Creating, assigning, cancelling experiments (database work, some reads of
  // Google data). Ship/rollout/rollback PRs use connector-write.
  "experiment-action": { limit: 40, windowSeconds: 3600, label: "experiment action" },
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string | null;
};

/**
 * Consume one unit from `subject`'s bucket for `tier`.
 *
 * `subject` should be a stable identity — the authenticated user id, optionally
 * qualified with a workspace id when the route has a validated one.
 */
export async function consumeRateLimit(
  tier: RateLimitTier,
  subject: string,
  opts: { cost?: number } = {},
): Promise<RateLimitResult> {
  const config = TIERS[tier];
  const permissive: RateLimitResult = {
    ok: true,
    limit: config.limit,
    remaining: config.limit,
    retryAfterSeconds: 0,
    resetAt: null,
  };

  try {
    const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
      p_bucket_key: `${tier}:${subject}`,
      p_window_seconds: config.windowSeconds,
      p_limit: config.limit,
      p_cost: opts.cost ?? 1,
    });

    if (error) {
      console.error(`[rate-limit] ${tier} query failed, failing open`, error.message);
      return permissive;
    }

    // The RPC returns a single row; supabase-js surfaces it as a 1-element array.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") return permissive;

    const resetAt: string | null = row.reset_at ?? null;
    const retryAfterSeconds = resetAt
      ? Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000))
      : config.windowSeconds;

    return {
      ok: row.allowed,
      limit: config.limit,
      remaining: Math.max(0, config.limit - (row.current_count ?? 0)),
      retryAfterSeconds,
      resetAt,
    };
  } catch (e) {
    console.error(`[rate-limit] ${tier} threw, failing open`, e);
    return permissive;
  }
}

/** 429 with the headers clients and proxies expect. */
export function rateLimitResponse(tier: RateLimitTier, result: RateLimitResult): Response {
  const config = TIERS[tier];
  const response = jsonError(
    429,
    `Too many ${config.label} requests. Please wait ${result.retryAfterSeconds}s and try again.`,
  );
  const headers = new Headers(response.headers);
  headers.set("Retry-After", String(result.retryAfterSeconds));
  headers.set("RateLimit-Limit", String(result.limit));
  headers.set("RateLimit-Remaining", String(result.remaining));
  if (result.resetAt) headers.set("RateLimit-Reset", String(result.retryAfterSeconds));
  return new Response(response.body, { status: 429, headers });
}

/**
 * The one call a route needs: returns a ready-to-return 429 when the caller is
 * over budget, or `null` when the request may proceed.
 *
 *   const limited = await enforceRateLimit("video", auth.userId);
 *   if (limited) return limited;
 */
export async function enforceRateLimit(
  tier: RateLimitTier,
  subject: string,
  opts: { cost?: number } = {},
): Promise<Response | null> {
  const result = await consumeRateLimit(tier, subject, opts);
  return result.ok ? null : rateLimitResponse(tier, result);
}

/** Thrown by the server-function middleware; /api/rpc maps it to a 429. */
export class RateLimitedError extends Error {
  constructor(
    readonly tier: RateLimitTier,
    readonly result: RateLimitResult,
  ) {
    super(`Rate limited: ${tier}`);
    this.name = "RateLimitedError";
  }
}

/**
 * Server-function counterpart to the /api kernel's `rateLimit` option. Place
 * it AFTER requireSupabaseAuth so the bucket is keyed by the verified user:
 *
 *   createServerFn({ method: "POST" })
 *     .middleware([requireSupabaseAuth, rateLimitFor("generate")])
 *
 * Input validation runs before middleware, so malformed calls are free.
 */
export function rateLimitFor(tier: RateLimitTier) {
  return createMiddleware({ type: "function" }).server(async ({ next, context }) => {
    const userId = typeof context.userId === "string" ? context.userId : null;
    if (!userId) {
      throw new Error("Unauthorized: rateLimitFor() must run after requireSupabaseAuth");
    }
    const result = await consumeRateLimit(tier, userId);
    if (!result.ok) throw new RateLimitedError(tier, result);
    return next({ context });
  });
}

/** Exposed for tests and for surfacing quotas in the UI. */
export function rateLimitTierConfig(tier: RateLimitTier): Readonly<TierConfig> {
  return TIERS[tier];
}
