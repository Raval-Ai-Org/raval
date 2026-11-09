// task-models.ts — the one place that decides which model answers which task.
//
// Every paid text call already carries a metering `route` label. This file maps
// each label to a plan: an ordered model list (sent to OpenRouter as `models`,
// so it fails over natively), a reasoning effort, a token ceiling and, where a
// task needs it, an escalation rule and a degraded plan for workspaces past
// their spend ceiling. Call sites never name a model; they name their route.
//
// Change a model without a deploy:
//   AI_MODEL_<ROUTE_KEY>=model-a,model-b   (primary first, then fallbacks)
//   AI_EFFORT_<ROUTE_KEY>=low|medium|high
// or, from the admin console (AI controls), a routing override stored in the
// database. Precedence: env var > admin override > this registry. An override
// may only name a model this file already uses (knownModels).
// ROUTE_KEY is the route upper-cased with non-alphanumerics as "_", e.g.
// AI_MODEL_BRAND_EXTRACT, AI_EFFORT_GEO_FIX_PROPOSE.
//
// Decision record: docs/adr/0026-openrouter-only-models.md. A test
// (task-models.test.ts) fails when a `route:` label in src/ has no entry here.
import "server-only";
import { routingOverrideFor } from "@/server/platform/routing-overrides.server";

/* ─────────────────────────── tiers (one-line swaps) ─────────────────────────── */

// Each tier is the cheapest model that does its kind of work well (cost
// review 2026-11-03, prices from OpenRouter /api/v1/models). Opus stays where
// the work is rare and high-stakes: code in customer repos, published
// articles, video storyboards.
export const PREMIUM = "anthropic/claude-opus-5.5";
/** Analysis and structured reading (Brand DNA, strategy); reads images. Half Opus's price. */
export const ANALYST = "openai/gpt-6.1-sol";
/** Conversation with tools (Mellox Pro chat, Coach). */
export const CONVERSATION = "anthropic/claude-sonnet-5.5";
/** Summaries and small structured jobs. A quarter of Opus's price. */
export const SUMMARY = "openai/gpt-6.1-terra";
export const WORKHORSE = "google/gemini-3.8-flash";
/** Text-only internal work (ideas, competitor reads). Full-precision hosts only. */
export const BUDGET = "deepseek/deepseek-v4.1-flash";
/** Labelling and yes/no sorting. Full-precision hosts only. */
export const LABELLER = "z-ai/glm-5.3-flash";
/** Small careful jobs that may read a picture (safety checks, caption edits). */
export const CAREFUL = "anthropic/claude-haiku-5.5";
export const LUNA = "openai/gpt-6-luna";
export const ECONOMY = "google/gemini-3.1-flash-lite";

/**
 * Open-weight models are served by many hosts, some of them 4-bit copies that
 * answer worse than the published model. The gateway keeps such a request on
 * full-precision hosts (see OPEN_WEIGHT_QUANTIZATIONS in the gateway).
 */
export function isOpenWeightModel(model: string): boolean {
  return /^(deepseek|z-ai|qwen|moonshotai|minimax|xiaomi|meta-llama|mistralai)\//.test(model);
}

/** What each tier falls back to when its providers fail (OpenRouter `models`). */
const FALLBACKS: Record<string, string[]> = {
  [PREMIUM]: [WORKHORSE],
  [ANALYST]: [WORKHORSE],
  [CONVERSATION]: [WORKHORSE],
  [SUMMARY]: [WORKHORSE],
  // A fallback should not cost more than the model it stands in for.
  [WORKHORSE]: [SUMMARY],
  [BUDGET]: [WORKHORSE],
  [LABELLER]: [ECONOMY],
  [CAREFUL]: [ECONOMY],
  [LUNA]: [ECONOMY],
  [ECONOMY]: [LUNA],
};

/** Past a workspace's spend ceiling each tier steps down one. */
const DEGRADE_TO: Record<string, string> = {
  [PREMIUM]: WORKHORSE,
  [ANALYST]: WORKHORSE,
  [CONVERSATION]: WORKHORSE,
  [SUMMARY]: WORKHORSE,
  [WORKHORSE]: ECONOMY,
  [BUDGET]: ECONOMY,
  [LABELLER]: LABELLER,
  [CAREFUL]: ECONOMY,
  [LUNA]: LUNA,
  [ECONOMY]: ECONOMY,
};

export type Effort = "low" | "medium" | "high";
const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

export type TaskPlan = {
  /** [primary, ...fallbacks], sent as OpenRouter `models`. */
  models: string[];
  /** OpenRouter `reasoning.effort`. */
  effort?: Effort;
  /** Output ceiling; must cover reasoning + the answer. */
  maxTokens?: number;
  temperature?: number;
  /** A documented rule the caller applies through `escalatedPlan`. */
  escalate?: { when: string; models: string[]; effort?: Effort };
  /** Used once the workspace is past its spend ceiling. */
  degraded?: { models: string[]; effort?: Effort };
};

function tier(
  primary: string,
  effort: Effort,
  extra: Omit<TaskPlan, "models" | "effort" | "degraded"> = {},
): TaskPlan {
  const down = DEGRADE_TO[primary] ?? primary;
  return {
    models: withFallbacks(primary),
    effort,
    ...extra,
    degraded: { models: withFallbacks(down), effort: effort === "high" ? "medium" : effort },
  };
}

function withFallbacks(primary: string): string[] {
  return [primary, ...(FALLBACKS[primary] ?? [])];
}

/** An escalation that swaps to another tier (models include its fallbacks). */
function toTier(when: string, primary: string, effort?: Effort): NonNullable<TaskPlan["escalate"]> {
  return { when, models: withFallbacks(primary), effort };
}

/* ─────────────────────────────── the registry ─────────────────────────────── */

// Keyed by route label. A key ending in ".*" matches every label with that
// prefix (for labels built at runtime, e.g. `ai-generate.${task}`).
const REGISTRY: Record<string, TaskPlan> = {
  // Brand DNA runs once per brand and everything builds on it.
  "brand-extract": tier(ANALYST, "medium", { maxTokens: 12_000 }),
  "brand-extract.search": tier(ECONOMY, "low"),
  "brand-visuals.analyze": tier(ANALYST, "medium", { maxTokens: 6_000 }),

  "memory-extract": tier(WORKHORSE, "low"),
  "file-extract": tier(ECONOMY, "low", {
    escalate: toTier("the first read came back thin (THIN_TEXT_CHARS)", WORKHORSE, "low"),
  }),

  // Chat: "mellox-flash" is `chat`, "mellox-pro" is `chat.pro`.
  chat: tier(WORKHORSE, "low", { maxTokens: 6_000 }),
  "chat.pro": tier(CONVERSATION, "low", {
    maxTokens: 8_000,
    escalate: {
      when: "chat-intent classifies the turn as strategy/analysis",
      models: withFallbacks(PREMIUM),
      effort: "medium",
    },
  }),
  "chat.research": tier(WORKHORSE, "medium"),
  "chat.history-summary": tier(LUNA, "low"),
  // tool_choice is always "auto" (Opus rejects forced tools; see the gateway).
  clarify: tier(WORKHORSE, "low"),

  // Content generation.
  "content.regenerate": tier(WORKHORSE, "medium"),
  "content.generateBatch": tier(WORKHORSE, "medium"),
  "content.generateNextPost": tier(WORKHORSE, "medium"),
  "content.planCalendar": tier(WORKHORSE, "medium"),
  "social.multi": tier(WORKHORSE, "medium"),
  "ai-generate": tier(WORKHORSE, "medium", {
    escalate: toTier("long-form output over ~1,500 words", PREMIUM, "medium"),
  }),
  "ai-generate.*": tier(WORKHORSE, "medium", {
    escalate: toTier("long-form output over ~1,500 words", PREMIUM, "medium"),
  }),

  // Studio. Articles go live on customer sites and must pass the GEO gate.
  "studio.article": tier(PREMIUM, "medium"),
  "studio.article.standard": tier(WORKHORSE, "medium", { maxTokens: 9000 }),
  "studio.social": tier(WORKHORSE, "medium"),
  "studio.carousel": tier(WORKHORSE, "medium"),
  "studio.story": tier(WORKHORSE, "medium"),
  "studio.script": tier(WORKHORSE, "medium"),
  "studio.ad": tier(WORKHORSE, "medium"),
  "studio.upload-captions": tier(WORKHORSE, "medium"),
  "studio.captions": tier(WORKHORSE, "medium"),
  "studio.caption.edit": tier(CAREFUL, "low", { maxTokens: 1800 }),
  "studio.naturalize": tier(WORKHORSE, "low"),
  // Reads the brand's own photos (faces, calm areas, colours) before a design.
  "studio.photo-read": tier(WORKHORSE, "low", { maxTokens: 2400 }),
  "studio.hero.concept": tier(WORKHORSE, "low", { maxTokens: 1500, temperature: 0.9 }),
  // Hears a branded clip's sound for its captions (Gemini Flash takes audio).
  // Not used when a local whisper.cpp is configured.
  "studio.transcribe": tier(WORKHORSE, "low", { maxTokens: 6000, temperature: 0 }),
  "studio.ideas": tier(BUDGET, "low", { temperature: 0.9 }),
  "studio.prompt": tier(BUDGET, "low"),
  "studio.research": tier(WORKHORSE, "medium"),
  "studio.trends": tier(WORKHORSE, "low"),
  // The visual brief a picture or video is made from (buildVisualBriefPrompt).
  "studio.image.brief": tier(WORKHORSE, "medium"),
  "studio.video.brief": tier(WORKHORSE, "medium"),
  // A new AI video's storyboard (buildVideoStoryboardPrompt): one text call,
  // and where a video's story and consistency are won, so the premium tier.
  "studio.video.storyboard": tier(PREMIUM, "medium", { maxTokens: 6_000 }),
  // A motion graphic's whole HTML/SVG + CSS document (src/lib/studio/motion/);
  // code checks it and draws it, so one careful call is the whole design.
  "studio.motion.compose": tier(PREMIUM, "medium", { maxTokens: 16_000 }),
  // Scores a finished video's sampled frames; code decides (src/lib/studio/video/checks.ts).
  "studio.video.qa": tier(WORKHORSE, "low", { maxTokens: 1_200 }),
  "studio.image.review": tier(WORKHORSE, "low", { maxTokens: 350 }),
  "brand-visuals.review": tier(WORKHORSE, "low", { maxTokens: 700 }),
  "campaign-generation": tier(ANALYST, "low"),
  // Campaigns (ADR-0039): the words for a laid-out campaign, and the brief
  // the designer's "Write it for me" fills in.
  "campaign.plan": tier(ANALYST, "medium", { maxTokens: 12_000 }),
  "campaign.write": tier(CAREFUL, "low"),
  "schedule.*": tier(WORKHORSE, "medium"),

  // Marketing Coach and Market Brain.
  coach: tier(CONVERSATION, "low", {
    escalate: {
      when: "deep strategy, isComplexStrategy or forced premium",
      models: withFallbacks(PREMIUM),
      effort: "high",
    },
  }),
  "coach.briefing": tier(SUMMARY, "low", {
    maxTokens: 8_000,
    escalate: {
      when: "deep strategy, isComplexStrategy or forced premium",
      models: withFallbacks(PREMIUM),
      effort: "high",
    },
  }),
  "coach.research": tier(WORKHORSE, "low"),
  "coach.trends": tier(WORKHORSE, "low"),
  "market-intelligence": tier(WORKHORSE, "medium", { maxTokens: 10_000 }),

  "analytics/insights": tier(BUDGET, "medium"),
  "analytics/insights-auto": tier(BUDGET, "low"),
  "agent.content-fit": tier(BUDGET, "low"),
  "agent.distribution-reliability": tier(LABELLER, "low"),

  // Competitors: grounded classification only; updates are high volume.
  "competitors.discovery": tier(BUDGET, "low"),
  "competitors.profile": tier(BUDGET, "low"),
  "competitors.updates": tier(LABELLER, "low"),
  // Community Intelligence: label and summarise supplied threads; draft one reply.
  "community.classify": tier(LABELLER, "low", { maxTokens: 4_000 }),
  "community.reply": tier(WORKHORSE, "low", { maxTokens: 2_000 }),
  // Autopilot: a week's plan over fixed slots, and a relevance read of
  // signals that were already collected.
  "autopilot.plan": tier(WORKHORSE, "medium"),
  "autopilot.strategy": tier(WORKHORSE, "low"),
  // The workspace marketing strategy, written from all four brains (ADR-0032).
  "strategy.generate": tier(ANALYST, "medium", { maxTokens: 12_000 }),
  "autopilot.opportunities": tier(LABELLER, "low"),
  "competitor-intel": tier(BUDGET, "medium"),

  // Audience (ADR-0031). Building the groups is rare and everything reads
  // them; scoring and simulated answers are high volume, so they stay cheap.
  "audience.twins": tier(ANALYST, "low", { maxTokens: 6_000 }),
  "audience.score": tier(ECONOMY, "low", { maxTokens: 1_200 }),
  "audience.react": tier(ECONOMY, "low", { maxTokens: 2_400, temperature: 0.8 }),
  "audience.synthesize": tier(WORKHORSE, "low", { maxTokens: 2_400 }),
  "audience.variants": tier(WORKHORSE, "medium", { maxTokens: 3_000, temperature: 0.9 }),

  // GEO. Probes mirror real answer engines: each model in GEO_PROBE_MODELS is
  // asked separately (see geoProbeModels), never as a fallback chain.
  "geo.probe": { models: ["perplexity/sonar"] },
  "geo.fix.propose": tier(PREMIUM, "medium", { maxTokens: 16_000 }),
  "geo.fix.batch": tier(PREMIUM, "medium", { maxTokens: 16_000 }),
  "geo.cms.fix": tier(WORKHORSE, "medium", {
    escalate: toTier("validation or grounding rejected the first output", PREMIUM, "medium"),
  }),
  // The GEO Engineer's stages keep their existing efforts.
  "geo.agent.investigate": tier(PREMIUM, "high", { maxTokens: 12_000 }),
  "geo.agent.implement": tier(PREMIUM, "medium", { maxTokens: 16_000 }),
  "geo.agent.review": tier(PREMIUM, "high", { maxTokens: 8_000 }),

  // Adding a blog to a site: which of the site's own class names suit it (rare,
  // once per site; the pages themselves come from fixed templates).
  "articles.blog-design": tier(SUMMARY, "low", { maxTokens: 4_000 }),

  // Proof Engine.
  "experiments.hypotheses": tier(SUMMARY, "low"),
  "experiments.values": tier(WORKHORSE, "medium"),
  "experiments.integration": tier(PREMIUM, "medium", { maxTokens: 16_000 }),

  // Backlink Growth.
  "links-topical-fit": tier(LABELLER, "low"),
  "links-relevance-pick": tier(BUDGET, "low"),
  "links-profile": tier(BUDGET, "low"),
  "links-article-brief": tier(WORKHORSE, "medium"),

  // UGC video ads.
  "ugc.product.extract": tier(BUDGET, "low"),
  "ugc.concepts": tier(WORKHORSE, "medium"),
  "ugc.notes": tier(BUDGET, "low"),

  // Safety review: the economy read clears ordinary media; anything it would
  // not clear is re-read by a stronger model, so one cheap mistake can never
  // confirm itself.
  "guardrails.image-moderation": tier(CAREFUL, "low", {
    escalate: toTier("the first read did not clear the image", WORKHORSE, "low"),
  }),
  "guardrails.media-safety": tier(CAREFUL, "low", {
    escalate: toTier("the first read did not clear the prompt", WORKHORSE, "low"),
  }),
};

/**
 * `route:` labels that are not paid model calls (web-search metering, rate
 * limits, cron and scope labels). The registry test skips these; everything
 * else in src/ must have an entry above.
 */
export const NON_MODEL_ROUTES: readonly string[] = [
  "geo.scan",
  "geo.citation-probe",
  "competitors.discovery.resolve",
  "competitors.resolve-name",
  "competitors.advance",
  "community.refresh",
  "market-brain.scheduled",
  "autopilot.run",
  "audience.run",
  "ugc/renders:create",
  "ugc/projects:concepts",
  "ugc/creators:create",
  "market/trends",
  "generate-image",
  "studio/jobs:advance",
  "video",
  "studio.video.voice",
  "studio.video.music",
  // Prefixes of labels built at runtime.
  "cron.*",
  "agent.*",
  "rpc.*",
];

/** The workhorse plan, used for an unknown label in production. */
const UNKNOWN_ROUTE_PLAN = tier(WORKHORSE, "medium");

/* ─────────────────────────────── resolution ─────────────────────────────── */

export function routeEnvKey(route: string): string {
  return route
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The registry key a label resolves to (exact, or the longest ".*" prefix). */
function lookupKey(route: string): string | undefined {
  if (REGISTRY[route]) return route;
  let best: string | undefined;
  for (const key of Object.keys(REGISTRY)) {
    if (!key.endsWith(".*")) continue;
    const prefix = key.slice(0, -1);
    if (route.startsWith(prefix) && (!best || prefix.length > best.length - 1)) best = key;
  }
  return best;
}

function lookup(route: string): TaskPlan | undefined {
  if (REGISTRY[route]) return REGISTRY[route];
  let best: { prefix: string; plan: TaskPlan } | undefined;
  for (const [key, plan] of Object.entries(REGISTRY)) {
    if (!key.endsWith(".*")) continue;
    const prefix = key.slice(0, -1); // keep the dot
    if (route.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
      best = { prefix, plan };
    }
  }
  return best?.plan;
}

/** True when the label has a registry entry (exact or wildcard). */
export function hasTaskPlan(route: string): boolean {
  return lookup(route) !== undefined;
}

const warned = new Set<string>();

function parseModels(raw: string | undefined): string[] | undefined {
  const models = (raw ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return models.length ? [...new Set(models)] : undefined;
}

function parseEffort(raw: string | undefined): Effort | undefined {
  const value = raw?.trim().toLowerCase();
  return EFFORTS.includes(value as Effort) ? (value as Effort) : undefined;
}

/**
 * The plan for a route, with env overrides applied. An unknown label throws
 * in development and tests (so a new call site can't ship unregistered) and
 * falls back to the workhorse tier in production with one logged warning.
 */
export function planFor(route: string): TaskPlan {
  let base = lookup(route);
  if (!base) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        `No model plan for route "${route}". Add it to src/server/ai/task-models.ts.`,
      );
    }
    if (!warned.has(route)) {
      warned.add(route);
      console.warn("[task-models] unknown route, using the workhorse tier", { route });
    }
    base = UNKNOWN_ROUTE_PLAN;
  }
  const key = routeEnvKey(route);
  const override = routingOverrideFor(lookupKey(route) ?? route);
  const allowed = knownModels();
  const overrideModels = override?.models?.filter((m) => allowed.has(m));
  const models =
    parseModels(process.env[`AI_MODEL_${key}`]) ??
    (overrideModels?.length ? overrideModels : undefined);
  const effort = parseEffort(process.env[`AI_EFFORT_${key}`]) ?? override?.effort;
  if (!models && !effort) return base;
  return {
    ...base,
    ...(models ? { models } : {}),
    ...(effort ? { effort } : {}),
  };
}

/**
 * The plan with its escalation applied when `condition` holds. A route with no
 * escalation rule returns its normal plan. Escalated models can still be
 * overridden per route with AI_MODEL_<ROUTE_KEY>_ESCALATED.
 */
export function escalatedPlan(route: string, condition: boolean): TaskPlan {
  const plan = planFor(route);
  if (!condition || !plan.escalate) return plan;
  const models =
    parseModels(process.env[`AI_MODEL_${routeEnvKey(route)}_ESCALATED`]) ?? plan.escalate.models;
  const primary = models[0];
  const down = DEGRADE_TO[primary] ?? primary;
  return {
    ...plan,
    models,
    effort: plan.escalate.effort ?? plan.effort,
    // Escalation never survives a spend ceiling: degrade from the escalated tier.
    degraded: { models: withFallbacks(down), effort: plan.degraded?.effort ?? "low" },
  };
}

/** The plan to use this call: `degraded` when the workspace is past its ceiling. */
export function effectivePlan(plan: TaskPlan, degraded: boolean): TaskPlan {
  if (!degraded || !plan.degraded) return plan;
  return { ...plan, models: plan.degraded.models, effort: plan.degraded.effort ?? plan.effort };
}

/** Primary model of a route's plan (for records such as `geo_agent_runs.model`). */
export function primaryModel(route: string): string {
  return planFor(route).models[0];
}

/**
 * Answer engines the GEO probe asks, each separately (GEO_PROBE_MODELS
 * overrides; comma-separated). These mirror real engines, so they are not a
 * fallback chain.
 */
export const DEFAULT_GEO_PROBE_MODELS = [
  "perplexity/sonar",
  "openai/gpt-6-luna",
  "google/gemini-3.8-flash",
] as const;

export function geoProbeModels(): string[] {
  return parseModels(process.env.GEO_PROBE_MODELS) ?? [...DEFAULT_GEO_PROBE_MODELS];
}

/** Every model the registry uses, which is all an admin override may choose from. */
export function knownModels(): Set<string> {
  const out = new Set<string>([PREMIUM, WORKHORSE, ECONOMY, ...Object.keys(FALLBACKS)]);
  for (const list of Object.values(FALLBACKS)) for (const model of list) out.add(model);
  for (const plan of Object.values(REGISTRY)) {
    for (const model of plan.models) out.add(model);
    for (const model of plan.escalate?.models ?? []) out.add(model);
    for (const model of plan.degraded?.models ?? []) out.add(model);
  }
  return out;
}

/** The registry key a label resolves to, for admin overrides. */
export function registryKeyFor(route: string): string | undefined {
  return lookupKey(route);
}

/** The registry plan for a key, with no override or env applied. */
export function registryPlan(key: string): TaskPlan | undefined {
  return REGISTRY[key];
}

/** Every label with an entry (tests, docs). */
export function registeredRoutes(): string[] {
  return Object.keys(REGISTRY);
}
