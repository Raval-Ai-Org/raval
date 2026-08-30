// Task-specific prompt builders. Every AI call site imports from here so a
// wording change lands in one place. Each builder returns a `{ system, user }`
// pair ready to hand to `runJsonPrompt`, `runTool`, `chatCompletion`, etc.
//
// Design rules:
//   * NEVER re-state a fragment that already lives in `./fragments`.
//   * Use `assemble` for the user prompt so empty context blocks vanish.
//   * Keep per-task prompts under ~250 tokens; put dynamic data in `user`.

import {
  ACTION_TAGS,
  FMT_CHAT,
  FMT_EXECUTIVE,
  FMT_JSON_STRICT,
  FMT_NO_FENCES,
  IDENTITY_BRAND_ANALYST,
  IDENTITY_CHAT,
  IDENTITY_COACH,
  IDENTITY_MEMORY_CURATOR,
  IDENTITY_OCR,
  IDENTITY_PLANNER,
  IDENTITY_STRATEGIST,
  INTENT_ENUM,
  PRODUCT_SURFACE,
  RULE_GROUNDING,
  RULE_NO_DUPES,
  RULE_NO_FLUFF,
  RULE_POST_LIMITS,
  RULE_SCOPE,
  SCHEMA_ITEMS,
  SCHEMA_POST,
  SCHEMA_POST_WITH_RATIONALE,
  SCHEMA_STEPS,
  SCHEMA_SUGGESTIONS,
  identityAgent,
  identitySocialPM,
} from "./fragments";
import { assemble, system } from "./assemble";

/* ============================== Chat =============================== */

export function chatSystem(): string {
  return system(
    IDENTITY_CHAT,
    RULE_SCOPE,
    RULE_GROUNDING,
    "When the user asks you to DO something: briefly explain AND emit action tags — the app parses and executes them.",
    FMT_CHAT,
    PRODUCT_SURFACE,
    ACTION_TAGS,
  );
}

export function chatContextBlock(context: string): string {
  const trimmed = context.trim();
  return trimmed
    ? `## Brand & workspace context (authoritative)\n${trimmed}`
    : "## Brand & workspace context\n(No Brand DNA captured yet.)";
}

/* ============================== Clarify ============================ */

export function clarifyPrompt(prompt: string, brandContext?: string) {
  return {
    system: system(
      IDENTITY_PLANNER,
      "Ask AT MOST 3 short multiple-choice questions that materially change the output (channel, tone, audience, scope, format, timing, budget).",
      "Skip clarification when the prompt is already concrete. Never ask for info already implied by the prompt or brand context.",
    ),
    user: assemble([
      { label: "Prompt", body: prompt, maxChars: 3800 },
      { label: "Brand context", body: brandContext, maxChars: 800 },
    ]),
  };
}

/* ============================== Suggestions ======================== */

export function suggestionsPrompt(args: {
  max: number;
  signals: unknown;
  brandContext?: string;
  lastUserMessage?: string;
}) {
  return {
    system: system(
      IDENTITY_STRATEGIST,
      `Suggest ${args.max} concrete NEXT actions grounded in real workspace signals.`,
      "Each item: label (3-7 word imperative), hint (4-10 word reason tied to a real signal), prompt (verbatim chat prompt), intent.",
      INTENT_ENUM,
      RULE_NO_FLUFF,
      "Never invent metrics. Vary intents. When signals are sparse, fall back to onboarding-style tasks (brand-dna, geo-audit, ideate).",
      FMT_JSON_STRICT,
      `Schema: ${SCHEMA_SUGGESTIONS}`,
    ),
    user: assemble([
      { label: "Workspace signals", body: JSON.stringify(args.signals) },
      { label: "Brand context", body: args.brandContext, maxChars: 4000 },
      {
        label: "User just said",
        body: args.lastUserMessage && `"${args.lastUserMessage}"`,
        maxChars: 800,
      },
    ]),
  };
}

/* ============================== Next-step planner ================== */

export function nextStepsPrompt(args: {
  brandContext?: string;
  stats: { pending: number; scheduled: number; published: number; recentTitles: string[] };
  lastUserMessage?: string;
}) {
  const state = [
    `pending:${args.stats.pending}`,
    `scheduled:${args.stats.scheduled}`,
    `published:${args.stats.published}`,
    args.stats.recentTitles.length
      ? `recent:${args.stats.recentTitles
          .slice(0, 5)
          .map((t) => `"${t}"`)
          .join(",")}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    system: system(
      IDENTITY_PLANNER,
      "Suggest exactly 4 NEXT actions specific to THIS brand, tied to current workspace state, one-click actionable. Marketing/SEO/social/content only.",
      FMT_JSON_STRICT,
      `Schema: ${SCHEMA_STEPS}`,
    ),
    user: assemble([
      { label: "Brand context", body: args.brandContext, maxChars: 4200 },
      { label: "Workspace state", body: state },
      { label: "Last user message", body: args.lastUserMessage, maxChars: 800 },
    ]),
  };
}

/* ============================== Content batch ====================== */

const AGENT_ROLE: Record<string, string> = {
  scout: "Scout, an SEO strategist",
  spark: "Spark, a content creator",
  echo: "Echo, a social media manager",
};

export function contentBatchPrompt(args: {
  agent: string;
  count: number;
  channels: string[];
  brandContext?: string;
  websiteUrl?: string | null;
}) {
  return {
    system: system(
      `You are ${AGENT_ROLE[args.agent] ?? AGENT_ROLE.spark} for Raval AI.`,
      "Match the brand: voice, audience, products, do/don't. Never invent unrelated products.",
      `Generate ${args.count} pieces. Channels available: ${args.channels.join(", ")}.`,
      "Tailor tone + length per channel. Hooks first. One clear CTA. Body ≤ 600 chars. ≤ 8 hashtags.",
      FMT_JSON_STRICT,
      FMT_NO_FENCES,
      `Schema: ${SCHEMA_ITEMS}`,
    ),
    userTail: assemble([
      { label: "Brand context", body: args.brandContext, maxChars: 5000 },
      { label: "Website", body: args.websiteUrl },
    ]),
  };
}

/* ============================== Regenerate item ==================== */

export function regeneratePrompt(args: {
  channel: string | null;
  kind: string;
  title: string;
  body: string;
}) {
  return {
    system: system(
      "You are an expert social copywriter.",
      `Rewrite for ${args.channel ?? "social"}: sharper hook, clearer CTA, fresh angle.`,
      RULE_POST_LIMITS,
      FMT_JSON_STRICT,
      `Schema: ${SCHEMA_POST}`,
    ),
    user: `Current title: ${args.title || "(none)"}\nCurrent body: ${args.body || "(none)"}\nKind: ${args.kind}`,
  };
}

/* ============================== Next post ========================== */

export function nextPostPrompt(args: {
  brandContext?: string;
  websiteUrl?: string | null;
  targetChannel: string;
  recentSummary: string;
}) {
  return {
    system: system(
      "You are Spark, a senior content strategist for Raval AI.",
      "Generate ONE next post — the highest-leverage follow-up given brand + recent history.",
      "Do NOT repeat angles, hooks, or topics from recent posts.",
      RULE_POST_LIMITS,
      "Tailor format + length to the target channel.",
      FMT_JSON_STRICT,
      FMT_NO_FENCES,
      `Schema: ${SCHEMA_POST_WITH_RATIONALE}`,
    ),
    user: assemble([
      { label: "Brand context", body: args.brandContext, maxChars: 4200 },
      { label: "Website", body: args.websiteUrl },
      { label: "Target channel", body: args.targetChannel },
      { label: "Recent posts (avoid repeating)", body: args.recentSummary, maxChars: 1600 },
    ]),
  };
}

/* ============================== Social multi ======================= */

export function socialMultiPrompt(spec: {
  label: string;
  maxChars: number;
  optimalChars: number;
  hashtags: [number, number];
  style: string;
}) {
  return system(
    identitySocialPM(spec.label),
    `Hard limit ${spec.maxChars} chars (body + hashtags). Sweet spot ~${spec.optimalChars}. Hashtags: ${spec.hashtags[0]}-${spec.hashtags[1]}.`,
    `Style: ${spec.style}`,
    FMT_JSON_STRICT,
    FMT_NO_FENCES,
    "Body includes emojis/line breaks/CTA — NOT hashtags (hashtags go in the array).",
    `Schema: ${SCHEMA_POST}`,
  );
}

/* ============================== ai-generate router ================= */

export const TASK_SYSTEMS: Record<string, string> = {
  "seo-audit": system(
    "You are an elite technical + content SEO auditor.",
    RULE_GROUNDING,
    "Return a crisp markdown audit: Title, Meta, H1, On-page issues, AEO/GEO opportunities, 5 quick wins.",
    "Never return blank content. Keep under 250 words.",
  ),
  "content-gen": system(
    "You are a senior content strategist.",
    RULE_GROUNDING,
    "Publish-ready copy with H2s + strong opening. Tight, useful, no fluff.",
  ),
  "ad-copy": system(
    "You are a direct-response ad copywriter.",
    "Return 3 variants as a markdown list: Headline (≤40c), Primary text (≤90 words), CTA.",
  ),
  "social-post": system(
    "You are a senior social media manager.",
    RULE_GROUNDING,
    "Ready-to-preview post: specific hook, useful body, CTA, relevant hashtags.",
  ),
  "crm-message": system(
    "You are a CRM lifecycle copywriter.",
    RULE_GROUNDING,
    "Short personalized email: subject + 90-word body + clear CTA.",
  ),
  competitor: system(
    "You are a competitive intel analyst.",
    "Summarize positioning, likely strengths/weaknesses, and 3 strategic openings.",
  ),
  "analytics-insight": system(
    "You are an analytics insights generator.",
    "Return 3 key trends, 2 anomalies, and 3 next experiments as tight markdown bullets.",
  ),
  freeform: system("You are Raval AI. Concise, decisive, actionable."),
};

/* ============================== Coach briefing ===================== */

export function coachSystem(dayName: string) {
  return system(
    IDENTITY_COACH,
    `Today is ${dayName}.`,
    "Return JSON matching the schema below EXACTLY.",
    "Schema: {greeting,headline,focus:{title,why,action:{label,prompt,intent}},wins[],risks[],competitors[],market[],plays[],weekPlan[]}",
    "Each list item: {title,detail,tone,action?:{label,prompt,intent},source?}",
    RULE_GROUNDING,
    "Cite sources from RESEARCH SNIPPETS in each item's 'source' field.",
    "action.prompt is a first-person chat prompt the user can send verbatim.",
    INTENT_ENUM,
    `Max 3 items per array. ${RULE_NO_FLUFF} If no evidence, return [].`,
    "Mirror the brand's actual language from SITE CONTENT (products, audience, tone).",
    FMT_EXECUTIVE,
  );
}

/* ============================== Memory extract ===================== */

export const MEMORY_SYSTEM = system(
  IDENTITY_MEMORY_CURATOR,
  RULE_NO_DUPES,
  "Return ONLY via the save_memory tool.",
);

/* ============================== Agent tasks ======================== */

export function agentTasksSystem(agentName: string, agentRole: string) {
  return system(
    identityAgent(`${agentName}, a ${agentRole}`),
    "Generate 4 concise, high-leverage to-do items for the operator.",
    "Each task = one imperative sentence (max 12 words). Add realistic notes and a 'due' hint when relevant.",
    "Return ONLY via the suggest_tasks tool.",
  );
}

/* ============================== Scheduler execution =============== */

export const SCHEDULE_SYSTEMS: Record<string, string> = {
  "social-post": system(
    "You are Echo, a senior social media manager for Raval AI.",
    "Write ONE ready-to-publish post for the requested channel.",
    RULE_POST_LIMITS,
    FMT_JSON_STRICT,
    FMT_NO_FENCES,
    `Schema: ${SCHEMA_POST}`,
  ),
  "content-gen": system(
    "You are Spark, a senior content strategist for Raval AI.",
    "Write ONE short publish-ready piece — scannable, with H2-style lines.",
    "Body 200-450 words.",
    FMT_JSON_STRICT,
    FMT_NO_FENCES,
    `Schema: ${SCHEMA_POST}`,
  ),
  "seo-audit": system(
    "You are Scout, an SEO strategist for Raval AI.",
    "Produce a concise on-page brief.",
    "Body sections: Target query, Intent, Answer snippet, Suggested H2s, 5 quick wins.",
    FMT_JSON_STRICT,
    FMT_NO_FENCES,
    `Schema: ${SCHEMA_POST}`,
  ),
  "crm-message": system(
    "You are a CRM lifecycle copywriter.",
    "Write ONE short personalized email. title = subject, body = preview + 90-word email.",
    FMT_JSON_STRICT,
    FMT_NO_FENCES,
    `Schema: ${SCHEMA_POST}`,
  ),
  custom: system(
    "You are Raval AI. Follow the user's prompt exactly.",
    FMT_JSON_STRICT,
    FMT_NO_FENCES,
    `Schema: ${SCHEMA_POST}`,
  ),
};

/* ============================== File extract ======================= */

export const FILE_EXTRACT_SYSTEM = system(
  IDENTITY_OCR,
  "Extract every readable piece of information so a downstream LLM can use it verbatim.",
  "Return plain text with (omit if empty): full transcription preserving order; tables as pipe-rows; one-paragraph objective visual description; notable numbers/dates/names/URLs.",
  "No commentary, no markdown headings beyond simple labels, no code fences.",
);

/* ============================== Brand extract ====================== */

export const BRAND_EXTRACT_SCHEMA_HINT = `{
 "brandName":string,"oneLiner":string,"about":string,
 "industry":string,"businessModel":string,"audience":string,
 "voice":string,"values":string,"products":string,
 "doRules":string,"dontRules":string,
 "mission":string,"vision":string,"positioning":string,"uniqueValueProp":string,
 "audienceTags":string[],"valueTags":string[],"keywords":string[],
 "colors":[{"name":string,"hex":string}],
 "fonts":string[],
 "competitors":[{"name":string,"url"?:string,"positioning"?:string,"strengths"?:string,"weaknesses"?:string,"notes"?:string}],
 "customerSignals":{"jobsToBeDone":string,"painPoints":string,"objections":string,"buyingTriggers":string,"decisionCriteria":string,"channels":string,"feedback":string},
 "insights":[{"title":string,"body":string}],
 "missing":string[]
}`;

export const BRAND_EXTRACT_SYSTEM = system(
  IDENTITY_BRAND_ANALYST,
  "From the multi-page crawl AND external web mentions, extract a deep brand profile, competitors, customer signals, and durable insights.",
  FMT_JSON_STRICT,
  'Do NOT invent facts not supported by provided text. If a field is unknown, set to "" (or []) and add its name to `missing`.',
  "Be specific and concrete — reuse the brand's own language.",
  "Constraints: oneLiner ≤100c; about ≤320c; mission/vision/positioning/uniqueValueProp ≤200c each (only if clearly stated/implied); voice ≤160c (tone descriptors).",
  "products = comma-separated actual names; values = 3-5; doRules/dontRules = 2-3 short guidelines each; tags/keywords = 3-8 short.",
  "colors = 3-6 palette entries from detected hex, each named (Primary/Accent/Ink/Surface).",
  "fonts = 1-3 families from detected list.",
  "competitors = ≤5, ONLY from external snippets or explicit on-site mentions.",
  "customerSignals = derived from testimonials/reviews/FAQ/objection handling; empty string if no evidence.",
  "insights = 3-8 durable non-obvious facts (title ≤60c, body ≤200c).",
);
