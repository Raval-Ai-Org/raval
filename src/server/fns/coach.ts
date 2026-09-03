import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runJsonPrompt } from "@/lib/ai";
import { coachSystem } from "@/lib/ai/prompts";
import { assemble } from "@/lib/ai/prompts/assemble";

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

async function fetchHtml(url: string, timeoutMs = 7000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 MelloxCoachBot" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("text")) return "";
    return await res.text();
  } catch {
    return "";
  }
}

async function ddgSearch(
  query: string,
  limit = 6,
  timeoutMs = 6000,
): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 MelloxCoachBot" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: { title: string; url: string; snippet: string }[] = [];
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

/* -------------------- AI call -------------------- */

// callJsonModel removed — coach briefings now use runJsonPrompt.

/* -------------------- Server function -------------------- */

export const getCoachBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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

    /* 1. Pull workspace + real signals from DB (in parallel) */
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

    /* 2. Auto-scrape the site and search the web (parallel, tolerant) */
    let siteText = "";
    let siteMeta: Record<string, string> = {};
    let hostname = "";
    let brandSeed = workspaceName || "";
    if (siteUrl) {
      try {
        const u = new URL(siteUrl);
        hostname = u.hostname;
      } catch {}
    }

    const research = await Promise.all([
      // Fetch homepage
      siteUrl ? fetchHtml(siteUrl, 7000) : Promise.resolve(""),
      // Fetch about page as bonus signal
      siteUrl ? fetchHtml(new URL("/about", siteUrl).toString(), 5000) : Promise.resolve(""),
      // Competitor discovery
      hostname || brandSeed
        ? ddgSearch(`${brandSeed || hostname} competitors alternatives`, 6)
        : Promise.resolve([]),
      // Reviews / customer voice
      hostname || brandSeed
        ? ddgSearch(`${brandSeed || hostname} review OR "vs" OR complaint`, 5)
        : Promise.resolve([]),
      // Market trend
      brandSeed || hostname
        ? ddgSearch(`${brandSeed || hostname} industry trends 2026`, 5)
        : Promise.resolve([]),
    ]);
    const [homeHtml, aboutHtml, compResults, reviewResults, trendResults] = research;

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

    /* 3. Aggregate cited sources */
    const cited: { label: string; url: string }[] = [];
    const pushCited = (items: { title: string; url: string }[], tag: string) => {
      for (const it of items.slice(0, 3)) {
        cited.push({ label: `${tag}: ${it.title.slice(0, 70)}`, url: it.url });
      }
    };
    pushCited(compResults, "Competitor");
    pushCited(reviewResults, "Voice of customer");
    pushCited(trendResults, "Market trend");

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

    /* 4. Reason with the strongest available model */
    const system = coachSystem(dayName);

    const user = assemble([
      { body: `Today: ${today.toISOString().slice(0, 10)} (${dayName})` },
      { body: `Brand seed: ${brandSeed || "(unknown — infer from site)"}` },
      { label: "Workspace signals", body: JSON.stringify(signals) },
      { label: "Brand context (saved Brand DNA)", body: data.brandContext, maxChars: 3500 },
      { label: "Site content (scraped just now)", body: siteText, maxChars: 6000 },
      {
        label: "Research snippets (competitors/reviews/trends)",
        body: JSON.stringify({
          competitors: compResults.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
          reviews: reviewResults.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
          trends: trendResults.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
        }),
        maxChars: 3500,
      },
    ]);

    const parsed = await runJsonPrompt<Partial<CoachBriefing>>({
      route: "coach.briefing",
      extraction: true,
      system,
      user,
      fallback: {},
      maxTokens: 1600,
      temperature: 0.4,
    });

    /* 5. Build final briefing (with resilient fallbacks) */
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

    const briefing: CoachBriefing = {
      greeting:
        parsed.greeting ??
        `Good ${today.getHours() < 12 ? "morning" : today.getHours() < 18 ? "afternoon" : "evening"}${brandSeed ? `, ${brandSeed}` : ""} — here's your ${dayName} brief`,
      headline: parsed.headline ?? "Let's build momentum today.",
      focus: parsed.focus ?? focusFallback,
      wins: (parsed.wins ?? []).slice(0, 3),
      risks: (parsed.risks ?? []).slice(0, 3),
      competitors: (parsed.competitors ?? []).slice(0, 3),
      market: (parsed.market ?? []).slice(0, 3),
      plays: (parsed.plays ?? []).slice(0, 3),
      weekPlan: (parsed.weekPlan ?? []).slice(0, 5),
      sources: cited.slice(0, 10),
      brandSnapshot: {
        name: brandSeed || workspaceName || undefined,
        oneLiner: siteMeta["og:description"] || siteMeta["description"] || undefined,
        website: siteUrl ?? undefined,
      },
      generatedAt: new Date().toISOString(),
    };

    return briefing;
  });
