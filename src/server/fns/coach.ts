import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { coachSystem } from "@/lib/ai/prompts";
import { assemble } from "@/lib/ai/prompts/assemble";
import { COACH_OUTPUT_SCHEMA } from "@/lib/ai/output-schemas";
import { claudeJsonPrompt, selectClaudeModel } from "@/lib/anthropic-gateway.server";
import { cache, digest } from "@/server/cache/store";
import { fetchPublicText } from "@/server/safe-fetch";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";

const uuid = z.string().uuid();

export type CoachIntent =
  | "geo-audit"
  | "brand-dna"
  | "plan-week"
  | "schedule"
  | "review-drafts"
  | "seo-brief"
  | "share"
  | "ideate"
  | "social"
  | "email"
  | "blog"
  | "competitor"
  | "market";

export interface CoachAction {
  label: string;
  prompt: string;
  intent: CoachIntent;
}

export interface CoachInsight {
  title: string;
  detail: string;
  action?: CoachAction;
  tone?: "positive" | "warning" | "neutral" | "opportunity";
  source?: string; // url or label — where the signal came from
}

export interface CoachBriefing {
  greeting: string;
  headline: string;
  focus: {
    title: string;
    why: string;
    action: CoachAction;
  };
  wins: CoachInsight[];
  risks: CoachInsight[];
  competitors: CoachInsight[];
  market: CoachInsight[];
  plays: CoachInsight[];
  weekPlan: string[];
  sources: { label: string; url: string }[]; // cited research
  brandSnapshot?: {
    name?: string;
    oneLiner?: string;
    industry?: string;
    website?: string;
  };
  generatedAt: string;
}

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

async function ddgSearch(query: string, limit = 6, timeoutMs = 6000): Promise<SearchResult[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 MelloxCoachBot" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: SearchResult[] = [];
    const re =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of html.matchAll(re)) {
      let url = m[1];
      const ud = url.match(/[?&]uddg=([^&]+)/);
      if (ud) {
        try {
          url = decodeURIComponent(ud[1]);
        } catch {}
      }
      const title = stripHtml(m[2], 200);
      const snippet = stripHtml(m[3], 320);
      if (title && url.startsWith("http")) out.push({ title, url, snippet });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
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

  const [homeHtml, aboutHtml, compResults, reviewResults, trendResults] = await Promise.all([
    // Fetch homepage
    siteUrl ? fetchHtml(siteUrl, 7000) : Promise.resolve(""),
    // Fetch about page as bonus signal
    siteUrl ? fetchHtml(new URL("/about", siteUrl).toString(), 5000) : Promise.resolve(""),
    // Competitor discovery
    seed ? ddgSearch(`${seed} competitors alternatives`, 6) : Promise.resolve([]),
    // Reviews / customer voice
    seed ? ddgSearch(`${seed} review OR "vs" OR complaint`, 5) : Promise.resolve([]),
    // Market trend
    seed ? ddgSearch(`${seed} industry trends 2026`, 5) : Promise.resolve([]),
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

  const research = { siteText, siteMeta, brandSeed, compResults, reviewResults, trendResults };
  // A total miss (site down, search blocked) is not cached: the next open retries.
  if (siteText || compResults.length || reviewResults.length || trendResults.length) {
    await cache.set(key, research, RESEARCH_TTL_SECONDS);
  }
  return research;
}

/* -------------------- Output normalisation -------------------- */

// The output schema requires every field, so "not applicable" arrives as "".
function cleanAction(action: Partial<CoachAction> | undefined): CoachAction | undefined {
  const label = action?.label?.trim();
  const prompt = action?.prompt?.trim();
  if (!label || !prompt) return undefined;
  return { label, prompt, intent: action?.intent ?? "ideate" };
}

function cleanItems(items: CoachInsight[] | undefined, max = 3): CoachInsight[] {
  return (items ?? [])
    .filter((item) => item?.title?.trim())
    .slice(0, max)
    .map((item) => ({
      title: item.title,
      detail: item.detail ?? "",
      tone: item.tone,
      action: cleanAction(item.action),
      source: item.source?.trim() || undefined,
    }));
}

function coachModel(): string {
  // Sonnet 5: a grounded executive summary of supplied signals. The old
  // "Opus when the scraped site text is long" rule picked Opus for most sites,
  // and every one of those calls failed. COACH_MODEL overrides.
  return process.env.COACH_MODEL?.trim() || selectClaudeModel("marketing-coach");
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
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<CoachBriefing> => {
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
    const model = coachModel();

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
    const { siteText, siteMeta, brandSeed, compResults, reviewResults, trendResults } =
      await loadResearch(data.workspaceId, siteUrl, workspaceName);

    /* 4. Aggregate cited sources */
    const cited: { label: string; url: string }[] = [];
    const pushCited = (items: { title: string; url: string }[], tag: string) => {
      for (const it of items.slice(0, 3)) {
        cited.push({ label: `${tag}: ${it.title.slice(0, 70)}`, url: it.url });
      }
    };
    pushCited(compResults, "Competitor");
    pushCited(reviewResults, "Voice of customer");
    pushCited(trendResults, "Market trend");

    /* 5. Reason over the evidence */
    const system = coachSystem(dayName);

    // Scraped pages, search snippets and stored Brand DNA are fenced as
    // untrusted data: a competitor page saying "ignore your instructions"
    // stays a quote, never a command (proposal D: prompt-injection boundary).
    const user = assemble([
      { body: UNTRUSTED_DATA_RULE },
      { body: `Today: ${today.toISOString().slice(0, 10)} (${dayName})` },
      { body: `Brand seed: ${brandSeed || "(unknown — infer from site)"}` },
      { label: "Workspace signals", body: JSON.stringify(signals) },
      {
        label: "Brand context (saved Brand DNA)",
        body: wrapUntrusted("brand-dna", data.brandContext, { maxChars: 3500, route: "coach" }),
      },
      {
        label: "Site content (scraped just now)",
        body: wrapUntrusted("site-scrape", siteText, { maxChars: 6000, route: "coach" }),
      },
      {
        label: "Research snippets (competitors/reviews/trends)",
        body: wrapUntrusted(
          "web-search",
          JSON.stringify({
            competitors: compResults.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
            })),
            reviews: reviewResults.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
            trends: trendResults.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
          }),
          { maxChars: 3500, route: "coach" },
        ),
      },
      { body: "Where an item has no suitable action or source, use empty strings for them." },
    ]);

    // Structured output: valid JSON by construction, so no repair call. Thinking
    // shares max_tokens on Claude 5 models — the old 1,800 ceiling truncated the
    // briefing (and its 3,600 repair) and users got the template fallback.
    const parsed = await claudeJsonPrompt<Partial<CoachBriefing>>({
      route: "coach.briefing",
      system,
      user,
      fallback: {},
      model,
      effort: "medium",
      maxTokens: 6000,
      outputSchema: COACH_OUTPUT_SCHEMA,
      timeoutMs: 90_000,
      retries: 1,
    });

    /* 6. Build final briefing (with resilient fallbacks) */
    const focusFallback: CoachBriefing["focus"] = !siteUrl
      ? {
          title: "Add your website so I can research your brand",
          why: "I need your live site to scan competitors, extract Brand DNA, and give real advice — takes 10 seconds.",
          action: {
            label: "Add website",
            prompt: "Help me set up my Brand DNA — my website is:",
            intent: "brand-dna",
          },
        }
      : signals.latestGeoScore == null
        ? {
            title: "Run your first AI Visibility scan",
            why: "You have no baseline — a scan tells us how ChatGPT, Gemini and Perplexity see your brand today.",
            action: {
              label: "Scan my site",
              prompt: "Run a full AI visibility audit of my site",
              intent: "geo-audit",
            },
          }
        : {
            title: "Publish something on-brand today",
            why: "Consistency compounds. One well-targeted post today beats five next week.",
            action: {
              label: "Draft a post",
              prompt: "Draft a LinkedIn post grounded in my brand DNA for today",
              intent: "social",
            },
          };

    const focusAction = cleanAction(parsed.focus?.action);
    const briefing: CoachBriefing = {
      greeting:
        parsed.greeting?.trim() ||
        `Good ${today.getHours() < 12 ? "morning" : today.getHours() < 18 ? "afternoon" : "evening"}${brandSeed ? `, ${brandSeed}` : ""} — here's your ${dayName} brief`,
      headline: parsed.headline?.trim() || "Let's build momentum today.",
      focus:
        parsed.focus?.title?.trim() && focusAction
          ? { title: parsed.focus.title, why: parsed.focus.why ?? "", action: focusAction }
          : focusFallback,
      wins: cleanItems(parsed.wins),
      risks: cleanItems(parsed.risks),
      competitors: cleanItems(parsed.competitors),
      market: cleanItems(parsed.market),
      plays: cleanItems(parsed.plays),
      weekPlan: (parsed.weekPlan ?? []).filter((s) => s?.trim()).slice(0, 5),
      sources: cited.slice(0, 10),
      brandSnapshot: {
        name: brandSeed || workspaceName || undefined,
        oneLiner: siteMeta["og:description"] || siteMeta["description"] || undefined,
        website: siteUrl ?? undefined,
      },
      generatedAt: new Date().toISOString(),
    };

    // Only a real model briefing is reused; a fallback is regenerated next time.
    if (Object.keys(parsed).length > 0) {
      await cache.set(briefingKey, briefing, BRIEFING_TTL_SECONDS);
    }
    return briefing;
  });
