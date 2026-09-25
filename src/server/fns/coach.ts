import "server-only";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { escalatedPlan } from "@/server/ai/task-models";
import { cache, digest } from "@/server/cache/store";
import { fetchPublicText } from "@/server/safe-fetch";
import { webSearch, webAnswer } from "@/server/research/web-search.server";
import {
  synthesizeCoachBriefing,
  type CoachBriefing,
  type CoachSynthesisInput,
} from "@/server/research/coach-briefing.server";
import { marketingCoachWorkflowEnabled } from "@/server/workflows/marketing-coach-flags.server";

export type {
  CoachIntent,
  CoachAction,
  CoachInsight,
  CoachBriefing,
} from "@/server/research/coach-briefing.server";

const uuid = z.string().uuid();

/* -------------------- Research helpers -------------------- */

function normalizeUrl(raw: string) {
  const t = raw.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function stripHtml(html: string, max = 6000) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// The workspace website is user-supplied: it is fetched through safeFetch
// (connect-time private-IP blocking, per-hop redirect checks, byte cap). The
// previous raw fetch(url, { redirect: "follow" }) would read
// http://169.254.169.254/ or localhost into the model prompt.
async function fetchHtml(url: string, timeoutMs = 7000): Promise<string> {
  return fetchPublicText(url, {
    headers: { "User-Agent": "Mozilla/5.0 MelloxCoachBot" },
    timeoutMs,
    maxBytes: 2 * 1024 * 1024,
    requireTextContent: true,
  });
}

type SearchResult = { title: string; url: string; snippet: string };

// Web research goes through the shared provider ladder (Tavily → Firecrawl →
// DuckDuckGo) in src/server/research/web-search.server.ts. This file used to
// carry its own copy of that ladder, byte-identical to the one in
// brand-extract.server.ts; both now call the same function so the Coach and
// Brand DNA can never disagree about what the web says.
async function searchWeb(query: string, limit = 6, timeoutMs = 6000): Promise<SearchResult[]> {
  const sources = await webSearch(query, { limit, timeoutMs, route: "coach.research" });
  return sources.map((source) => ({
    title: source.title,
    url: source.url,
    snippet: source.snippet,
  }));
}

// The week's market movement, asked as a question. Tavily can return a short
// grounded summary with it; with any other provider the answer is empty and
// Claude reasons from the sources alone, which is the intended arrangement —
// the provider supplies information, Mellox supplies the intelligence.
async function trendResearch(seed: string): Promise<{ answer: string; results: SearchResult[] }> {
  const { answer, sources } = await webAnswer(`What is changing in the ${seed} market right now?`, {
    limit: 5,
    topic: "news",
    days: 30,
    timeoutMs: 8000,
    route: "coach.trends",
  });
  return {
    answer,
    results: sources.map((source) => ({
      title: source.title,
      url: source.url,
      snippet: source.snippet,
    })),
  };
}

function extractMeta(html: string) {
  const metas: Record<string, string> = {};
  const re = /<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/gi;
  for (const m of html.matchAll(re)) metas[m[1].toLowerCase()] = m[2];
  return metas;
}

/* -------------------- Caching -------------------- */

// Site scrape + three web searches change slowly; a refresh inside this window
// reuses them instead of re-crawling.
const RESEARCH_TTL_SECONDS = 3 * 3600;
// A generated briefing is reused until the workspace signals, the Brand DNA or
// the day change. "Refresh" (force) always generates a new one.
const BRIEFING_TTL_SECONDS = 6 * 3600;

type CoachResearch = {
  siteText: string;
  siteMeta: Record<string, string>;
  brandSeed: string;
  compResults: SearchResult[];
  reviewResults: SearchResult[];
  trendResults: SearchResult[];
  /** A short grounded market summary when the provider can produce one. */
  trendAnswer: string;
};

async function loadResearch(
  workspaceId: string,
  siteUrl: string | null,
  workspaceName: string,
): Promise<CoachResearch> {
  const key = `coach:research:${await digest(`${workspaceId}|${siteUrl ?? ""}|${workspaceName}`)}`;
  const hit = await cache.get<CoachResearch>(key);
  if (hit) return hit;

  let hostname = "";
  if (siteUrl) {
    try {
      hostname = new URL(siteUrl).hostname;
    } catch {}
  }
  let brandSeed = workspaceName || "";
  const seed = brandSeed || hostname;

  const [homeHtml, aboutHtml, compResults, reviewResults, trends] = await Promise.all([
    // Fetch homepage
    siteUrl ? fetchHtml(siteUrl, 7000) : Promise.resolve(""),
    // Fetch about page as bonus signal
    siteUrl ? fetchHtml(new URL("/about", siteUrl).toString(), 5000) : Promise.resolve(""),
    // Competitor discovery
    seed ? searchWeb(`${seed} competitors alternatives`, 6) : Promise.resolve([]),
    // Reviews / customer voice
    seed ? searchWeb(`${seed} review OR "vs" OR complaint`, 5) : Promise.resolve([]),
    // Market trend — asked as a question so the provider can return a grounded
    // summary alongside the sources. Recent coverage only: a two-year-old
    // trend piece is worse than none for a weekly briefing.
    seed ? trendResearch(seed) : Promise.resolve({ answer: "", results: [] }),
  ]);

  let siteText = "";
  let siteMeta: Record<string, string> = {};
  if (homeHtml) {
    siteMeta = extractMeta(homeHtml);
    siteText = [
      `[HOMEPAGE ${siteUrl}]`,
      stripHtml(homeHtml, 4000),
      aboutHtml ? `[ABOUT]\n${stripHtml(aboutHtml, 2500)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 7000);
    if (!brandSeed) {
      brandSeed =
        siteMeta["og:site_name"] ||
        siteMeta["og:title"]?.split(/[|·\-—]/)[0]?.trim() ||
        hostname.replace(/^www\./, "").split(".")[0];
    }
  }

  const research: CoachResearch = {
    siteText,
    siteMeta,
    brandSeed,
    compResults,
    reviewResults,
    trendResults: trends.results,
    trendAnswer: trends.answer,
  };
  // A total miss (site down, search blocked) is not cached: the next open retries.
  if (siteText || compResults.length || reviewResults.length || trends.results.length) {
    await cache.set(key, research, RESEARCH_TTL_SECONDS);
  }
  return research;
}

/* -------------------- Output normalisation -------------------- */

/**
 * The model the briefing will use (part of its cache key). The route plan
 * decides it: `coach.briefing` in src/server/ai/task-models.ts, escalated to
 * high effort for a deep-strategy briefing.
 */
function coachModel(deepStrategy: boolean): string {
  const plan = escalatedPlan("coach.briefing", deepStrategy);
  return `${plan.models[0]}:${plan.effort ?? "default"}`;
}

/* -------------------- Server function -------------------- */

export const getCoachBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audit")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        brandContext: z.string().max(8000).optional(),
        force: z.boolean().optional(),
        /** Ask for the deeper (high-effort) strategy briefing. */
        deepStrategy: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<CoachBriefing> => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();

    /* 1. Pull workspace + real signals from DB (in parallel, RLS-scoped) */
    const [
      wsRow,
      publishedRecent,
      scheduledNext,
      draftsCount,
      latestAudit,
      prevAudit,
      insights,
      recentContent,
    ] = await Promise.all([
      context.supabase
        .from("workspaces")
        .select("name, website_url")
        .eq("id", data.workspaceId)
        .maybeSingle(),
      context.supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", data.workspaceId)
        .eq("status", "published")
        .gte("updated_at", weekAgo),
      context.supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", data.workspaceId)
        .eq("status", "scheduled")
        .lte("scheduled_at", nextWeek),
      context.supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", data.workspaceId)
        .in("status", ["draft", "pending"]),
      context.supabase
        .from("geo_audit_runs")
        .select("score, subscores, created_at")
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("geo_audit_runs")
        .select("score, created_at")
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: false })
        .range(1, 1)
        .maybeSingle(),
      context.supabase
        .from("memory_insights")
        .select("body, kind, source_label")
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: false })
        .limit(20),
      context.supabase
        .from("content_items")
        .select("title, kind, status")
        .eq("workspace_id", data.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(8),
    ]);

    const workspaceName = wsRow.data?.name ?? "";
    const rawUrl = wsRow.data?.website_url?.trim() ?? "";
    const siteUrl = rawUrl ? normalizeUrl(rawUrl) : null;

    const signals = {
      workspaceName,
      website: siteUrl,
      publishedLast7d: publishedRecent.count ?? 0,
      scheduledNext7d: scheduledNext.count ?? 0,
      pendingDrafts: draftsCount.count ?? 0,
      latestGeoScore: latestAudit.data?.score ?? null,
      previousGeoScore: prevAudit.data?.score ?? null,
      geoSubscores: latestAudit.data?.subscores ?? null,
      recentInsights: (insights.data ?? []).map((r) => r.body).slice(0, 12),
      recentContent: (recentContent.data ?? []).map((r) => `${r.status}: ${r.kind} — ${r.title}`),
    };

    const today = new Date();
    const dayName = today.toLocaleDateString("en-US", { weekday: "long" });
    const deepStrategy = data.deepStrategy === true;
    const model = coachModel(deepStrategy);

    /* 2. Reuse today's briefing while nothing it was built from has changed */
    const briefingKey = `coach:briefing:${await digest(
      JSON.stringify({
        workspaceId: data.workspaceId,
        day: today.toISOString().slice(0, 10),
        signals,
        brandContext: data.brandContext ?? "",
        model,
      }),
    )}`;
    if (!data.force) {
      const cached = await cache.get<CoachBriefing>(briefingKey);
      if (cached) return cached;
    }

    /* 3. Scrape the site and search the web (cached, tolerant) */
    const { siteText, siteMeta, brandSeed, compResults, reviewResults, trendResults, trendAnswer } =
      await loadResearch(data.workspaceId, siteUrl, workspaceName);

    /* 4-6. Build the prompt, call Claude, and normalize — extracted to
     * src/server/research/coach-briefing.server.ts (ADR-0021) so it can
     * optionally run through Mastra for retry/observability. Off by
     * default: synthesizeCoachBriefing() is called directly, byte-for-byte
     * the same code path as before this extraction. */
    const synthesisInput: CoachSynthesisInput = {
      today,
      dayName,
      siteUrl,
      brandSeed,
      model,
      deepStrategy,
      signals,
      brandContext: data.brandContext,
      siteText,
      siteMeta,
      compResults,
      reviewResults,
      trendResults,
      trendAnswer,
    };
    const { briefing, hasContent } = marketingCoachWorkflowEnabled()
      ? await (
          await import("@/server/workflows/mastra.server")
        ).runWorkflow<"marketingCoach", { briefing: CoachBriefing; hasContent: boolean }>(
          "marketingCoach",
          { ...synthesisInput, today: today.toISOString() },
        )
      : await synthesizeCoachBriefing(synthesisInput);

    // Only a real model briefing is reused; a fallback is regenerated next time.
    if (hasContent) {
      await cache.set(briefingKey, briefing, BRIEFING_TTL_SECONDS);
    }
    return briefing;
  });
