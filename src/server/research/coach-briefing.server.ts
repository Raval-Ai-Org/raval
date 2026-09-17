// coach-briefing.server.ts — the pure synthesis half of Marketing Coach:
// given already-gathered workspace signals and research, build the prompt,
// call Claude, and normalize the result into a CoachBriefing. Split out of
// src/server/fns/coach.ts's getCoachBriefing() handler so
// src/server/workflows/marketing-coach.workflow.ts (flagged, off by
// default — ADR-0019) can wrap it with Mastra's retry/observability without
// touching the RLS-scoped DB-gathering half, which stays exactly where it
// was. getCoachBriefing() calls this function directly when the flag is
// off, so default behavior is byte-for-byte unchanged.
import "server-only";
import { coachSystem } from "@/lib/ai/prompts";
import { assemble } from "@/lib/ai/prompts/assemble";
import { COACH_OUTPUT_SCHEMA } from "@/lib/ai/output-schemas";
import { claudeJsonPrompt } from "@/lib/anthropic-gateway.server";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";

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

export type CoachSearchResult = { title: string; url: string; snippet: string };

export type CoachSignals = {
  workspaceName: string;
  website: string | null;
  publishedLast7d: number;
  scheduledNext7d: number;
  pendingDrafts: number;
  latestGeoScore: number | null;
  previousGeoScore: number | null;
  geoSubscores?: unknown;
  recentInsights: string[];
  recentContent: string[];
};

export type CoachSynthesisInput = {
  today: Date;
  dayName: string;
  siteUrl: string | null;
  brandSeed: string;
  model: string;
  signals: CoachSignals;
  brandContext?: string;
  siteText: string;
  siteMeta: Record<string, string>;
  compResults: CoachSearchResult[];
  reviewResults: CoachSearchResult[];
  trendResults: CoachSearchResult[];
};

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

export type CoachSynthesisResult = {
  briefing: CoachBriefing;
  /** False when Claude returned nothing usable — the caller shouldn't cache a pure fallback. */
  hasContent: boolean;
};

/**
 * Build the prompt, call Claude, and normalize the result into a
 * CoachBriefing. Pure aside from the Claude call itself — no DB reads, no
 * caching (both stay in getCoachBriefing()).
 */
export async function synthesizeCoachBriefing(
  input: CoachSynthesisInput,
): Promise<CoachSynthesisResult> {
  const { today, dayName, siteUrl, brandSeed, model, signals, brandContext } = input;
  const { siteText, siteMeta, compResults, reviewResults, trendResults } = input;

  const cited: { label: string; url: string }[] = [];
  const pushCited = (items: { title: string; url: string }[], tag: string) => {
    for (const it of items.slice(0, 3)) {
      cited.push({ label: `${tag}: ${it.title.slice(0, 70)}`, url: it.url });
    }
  };
  pushCited(compResults, "Competitor");
  pushCited(reviewResults, "Voice of customer");
  pushCited(trendResults, "Market trend");

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
      body: wrapUntrusted("brand-dna", brandContext, { maxChars: 3500, route: "coach" }),
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
          competitors: compResults.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
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
      name: brandSeed || signals.workspaceName || undefined,
      oneLiner: siteMeta["og:description"] || siteMeta["description"] || undefined,
      website: siteUrl ?? undefined,
    },
    generatedAt: new Date().toISOString(),
  };

  return { briefing, hasContent: Object.keys(parsed).length > 0 };
}
