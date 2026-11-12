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
// reviews 2026-11-03 and 2026-11-12; prices from OpenRouter /api/v1/models,
// quality from the Artificial Analysis Intelligence Index v5).
/**
 * Rare, high-stakes work: code in customer repos, published articles, video
 * storyboards, motion graphics, escalations. Gemini 4 Carbon scores above
 * Opus 5.5 (index 60.0 vs 59.1) at half its price ($2/$10 vs $4/$20), and in
 * the 2026-11-12 side-by-side its storyboards passed every check at about a
 * fifth of Opus's cost. Opus stays one override away (`OPUS`).
 */
export const PREMIUM = "google/gemini-4-carbon";
/** The previous premium model: kept selectable as the rollback (`AI_MODEL_<ROUTE>`). */
export const OPUS = "anthropic/claude-opus-5.5";
/** Analysis and structured reading (Brand DNA, strategy); reads images. */
export const ANALYST = "openai/gpt-6.1-sol";
/** Conversation with tools (Mellox Pro chat, Coach, Creator scripts). */
export const CONVERSATION = "anthropic/claude-sonnet-5.5";
/**
 * Every text writer people see (Studio copy, Flash chat, plans, briefings) and
 * the small careful jobs; reads pictures. Scores above Gemini 3.8 Flash (index
 * 36.5 vs 30.9) at an eighth of its price (cost review 2026-11-12). It takes
 * no `temperature`: Claude's default sampling already varies its answers.
 */
export const WRITER = "anthropic/claude-haiku-5.5";
/** Summaries and small structured jobs (was GPT-6.1 Terra, ten times the price). */
export const SUMMARY = WRITER;
/** Safety checks, caption edits, "Write it for me". */
export const CAREFUL = WRITER;
/** Image text reads and audience scores (was Gemini 3.1 Flash-Lite: dearer, index 6.2). */
export const ECONOMY = WRITER;
/** Pictures, video frames and sound: the vision checks and transcription. */
export const WORKHORSE = "google/gemini-3.8-flash";
/**
 * Text-only internal work (ideas, competitor reads). The 1017 snapshot is half
 * V4.1 Flash's price at the same index. Full-precision hosts only.
 */
export const BUDGET = "deepseek/deepseek-v4.1-flash-1017";
/** Labelling and yes/no sorting. Full-precision hosts only. */
export const LABELLER = "z-ai/glm-5.3-flash";
export const LUNA = "openai/gpt-6-luna";

/**
 * Open-weight models are served by many hosts, some of them 4-bit copies that
 * answer worse than the published model. The gateway keeps such a request on
 * full-precision hosts (see OPEN_WEIGHT_QUANTIZATIONS in the gateway).
 */
export function isOpenWeightModel(model: string): boolean {
  return /^(deepseek|z-ai|qwen|moonshotai|minimax|xiaomi|meta-llama|mistralai)\//.test(model);
}

/**
 * Models that accept `reasoning.effort: "none"` (checked live on OpenRouter,
 * 2026-11-12). Gemini 3.8 Flash, GLM-5.3 Flash and MiniMax M3.1 Flash answer
 * 400 "Reasoning is mandatory"; Opus rejects disabled thinking.
 */
export function canTurnReasoningOff(model: string): boolean {
  return /^(deepseek\/|anthropic\/claude-haiku-|openai\/gpt-6-luna)/.test(model);
}

/**
 * What each tier falls back to when its providers fail (OpenRouter `models`).
 * Keyed by model id: WRITER, SUMMARY, CAREFUL and ECONOMY are one model.
 */
const FALLBACKS: Record<string, string[]> = {
  [PREMIUM]: [WORKHORSE],
  [ANALYST]: [WORKHORSE],
  [CONVERSATION]: [WORKHORSE],
  // A fallback should not cost more than the model it stands in for.
  [WRITER]: [LUNA],
  [WORKHORSE]: [WRITER],
  [BUDGET]: [WRITER],
  [LABELLER]: [LUNA],
  [LUNA]: [WRITER],
};

/** Past a workspace's spend ceiling each tier steps down one. */
const DEGRADE_TO: Record<string, string> = {
  [PREMIUM]: WRITER,
  [ANALYST]: WRITER,
  [CONVERSATION]: WRITER,
  // Already the cheapest that does the work: only the effort steps down.
  [WRITER]: WRITER,
  // Pictures and sound need it (nothing cheaper hears audio).
  [WORKHORSE]: WORKHORSE,
  [BUDGET]: BUDGET,
  [LABELLER]: LABELLER,
  [LUNA]: LUNA,
};

/** "none" turns reasoning off where every model in the plan allows it (`canTurnReasoningOff`). */
export type Effort = "none" | "low" | "medium" | "high";
const EFFORTS: readonly Effort[] = ["none", "low", "medium", "high"];

export type TaskPlan = {
  /** [primary, ...fallbacks], sent as OpenRouter `models`. */
  models: string[];
  /** OpenRouter `reasoning.effort`. */
  effort?: Effort;
  /** Output ceiling; must cover reasoning + the answer. */
  maxTokens?: number;
  temperature?: number;
  /**
   * How long one call may take when the caller sets no limit. Long designed
   * output (code, motion graphics, storyboards) on a reasoning model can run
   * past the gateway's 60 s default.
   */
  timeoutMs?: number;
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

  "memory-extract": tier(WRITER, "low"),
  "file-extract": tier(ECONOMY, "low", {
    escalate: toTier("the first read came back thin (THIN_TEXT_CHARS)", WORKHORSE, "low"),
  }),

  // Chat: "mellox-flash" is `chat`, "mellox-pro" is `chat.pro`.
  chat: tier(WRITER, "low", { maxTokens: 6_000 }),
  // No escalation: every Pro turn is Sonnet (Mellox Lean). The old rule sent
  // turns a heuristic called "strategy" to Opus.
  "chat.pro": tier(CONVERSATION, "low", { maxTokens: 8_000 }),
  "chat.research": tier(WRITER, "medium"),
  "chat.history-summary": tier(LUNA, "low"),
  // tool_choice is always "auto" (Opus rejects forced tools; see the gateway).
  clarify: tier(WRITER, "low"),

  // Content generation.
  "content.regenerate": tier(WRITER, "medium"),
  "content.generateBatch": tier(WRITER, "medium"),
  "content.generateNextPost": tier(WRITER, "medium"),
  "content.planCalendar": tier(WRITER, "medium"),
  "social.multi": tier(WRITER, "medium"),
  "ai-generate": tier(WRITER, "medium", {
    escalate: toTier("long-form output over ~1,500 words", PREMIUM, "medium"),
  }),
  "ai-generate.*": tier(WRITER, "medium", {
    escalate: toTier("long-form output over ~1,500 words", PREMIUM, "medium"),
  }),

  // Studio. Articles go live on customer sites and must pass the GEO gate.
  "studio.article": tier(PREMIUM, "medium", { timeoutMs: 240_000 }),
  "studio.article.standard": tier(WRITER, "medium", { maxTokens: 9000 }),
  // The high-volume Studio writers think briefly (Mellox Lean): reasoning is
  // billed as output, and the structured schema, shapeOutput and grounding
  // checks catch a bad answer. Scripts and articles keep medium.
  "studio.social": tier(WRITER, "low"),
  "studio.carousel": tier(WRITER, "low"),
  "studio.story": tier(WRITER, "low"),
  "studio.script": tier(WRITER, "medium"),
  "studio.ad": tier(WRITER, "low"),
  "studio.upload-captions": tier(WRITER, "medium"),
  "studio.captions": tier(WRITER, "low"),
  "studio.caption.edit": tier(CAREFUL, "low", { maxTokens: 1800 }),
  "studio.naturalize": tier(WRITER, "low"),
  // Reads the brand's own photos (faces, calm areas, colours) before a design.
  "studio.photo-read": tier(WORKHORSE, "low", { maxTokens: 2400 }),
  "studio.hero.concept": tier(WRITER, "low", { maxTokens: 1500, temperature: 0.9 }),
  // Hears a branded clip's sound for its captions (Gemini Flash takes audio).
  // Not used when a local whisper.cpp is configured.
  "studio.transcribe": tier(WORKHORSE, "low", { maxTokens: 6000, temperature: 0 }),
  // Ideas and prompt help need no chain of thought: at "low" DeepSeek still
  // spent 77% of its output (about 4,200 tokens a call) reasoning.
  "studio.ideas": tier(BUDGET, "none", { temperature: 0.9 }),
  "studio.prompt": tier(BUDGET, "none"),
  "studio.research": tier(WRITER, "medium"),
  "studio.trends": tier(WRITER, "low"),
  // The visual brief a picture or video is made from (buildVisualBriefPrompt).
  "studio.image.brief": tier(WRITER, "low"),
  "studio.video.brief": tier(WRITER, "low"),
  // A new AI video's storyboard (buildVideoStoryboardPrompt): one text call,
  // and where a video's story and consistency are won, so the premium tier.
  "studio.video.storyboard": tier(PREMIUM, "medium", { maxTokens: 6_000, timeoutMs: 240_000 }),
  // A motion graphic's whole HTML/SVG + CSS document (src/lib/studio/motion/);
  // code checks it and draws it, so one careful call is the whole design.
  "studio.motion.compose": tier(PREMIUM, "medium", { maxTokens: 16_000, timeoutMs: 300_000 }),
  // Scores a finished video's sampled frames; code decides (src/lib/studio/video/checks.ts).
  "studio.video.qa": tier(WORKHORSE, "low", { maxTokens: 1_200 }),
  "studio.image.review": tier(WORKHORSE, "low", { maxTokens: 350 }),
  "brand-visuals.review": tier(WORKHORSE, "low", { maxTokens: 700 }),
  "campaign-generation": tier(ANALYST, "low"),
  // Campaigns (ADR-0039): the words for a laid-out campaign, and the brief
  // the designer's "Write it for me" fills in.
  "campaign.plan": tier(ANALYST, "medium", { maxTokens: 12_000 }),
  "campaign.write": tier(CAREFUL, "low"),
  "schedule.*": tier(WRITER, "medium"),

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
  "coach.research": tier(WRITER, "low"),
  "coach.trends": tier(WRITER, "low"),
  "market-intelligence": tier(WRITER, "medium", { maxTokens: 10_000 }),

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
  "community.reply": tier(WRITER, "low", { maxTokens: 2_000 }),
  // Autopilot: a week's plan over fixed slots, and a relevance read of
  // signals that were already collected.
  "autopilot.plan": tier(WRITER, "medium"),
  "autopilot.strategy": tier(WRITER, "low"),
  // The workspace marketing strategy, written from all four brains (ADR-0032).
  "strategy.generate": tier(ANALYST, "medium", { maxTokens: 12_000 }),
  "autopilot.opportunities": tier(LABELLER, "low"),
  "competitor-intel": tier(BUDGET, "medium"),

  // Audience (ADR-0031). Building the groups is rare and everything reads
  // them; scoring and simulated answers are high volume, so they stay cheap.
  "audience.twins": tier(ANALYST, "low", { maxTokens: 6_000 }),
  "audience.score": tier(ECONOMY, "low", { maxTokens: 1_200 }),
  "audience.react": tier(ECONOMY, "low", { maxTokens: 2_400, temperature: 0.8 }),
  "audience.synthesize": tier(WRITER, "low", { maxTokens: 2_400 }),
  "audience.variants": tier(WRITER, "medium", { maxTokens: 3_000, temperature: 0.9 }),

  // GEO. Probes mirror real answer engines: each model in GEO_PROBE_MODELS is
  // asked separately (see geoProbeModels), never as a fallback chain.
  "geo.probe": { models: ["perplexity/sonar"] },
  "geo.fix.propose": tier(PREMIUM, "medium", { maxTokens: 16_000, timeoutMs: 240_000 }),
  "geo.fix.batch": tier(PREMIUM, "medium", { maxTokens: 16_000, timeoutMs: 240_000 }),
  "geo.cms.fix": tier(WRITER, "medium", {
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
  "experiments.values": tier(WRITER, "medium"),
  "experiments.integration": tier(PREMIUM, "medium", { maxTokens: 16_000, timeoutMs: 240_000 }),

  // Backlink Growth.
  "links-topical-fit": tier(LABELLER, "low"),
  "links-relevance-pick": tier(BUDGET, "low"),
  "links-profile": tier(BUDGET, "low"),
  "links-article-brief": tier(WRITER, "medium"),

  // UGC video ads.
  "ugc.product.extract": tier(BUDGET, "low"),
  // Story, comedy timing and natural speech are the product here (ADR-0046):
  // Sonnet writes Creator video scripts. AI_MODEL_UGC_CONCEPTS rolls it back.
  "ugc.concepts": tier(CONVERSATION, "medium", { maxTokens: 10_000 }),
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
  "ugc/projects:storyboard",
  "ugc/creators:create",
  "market/trends",
  "generate-image",
  "studio/jobs:advance",
  "video",
  "studio.video.voice",
  "studio.video.music",
  // Image and video spend labels (ImageMeterRoute, studio.video.clip): metered
  // per picture or clip, never a text model call.
  "studio.image.render",
  "studio.image.rerender",
  "studio.image.version",
  "studio.image.backdrop",
  "studio.image.slide",
  "studio.image.edit",
  "studio.image.cutout",
  "studio.image.design",
  "studio.image.storyboard",
  "studio.video.clip",
  // The local open-source sidecar (src/server/local-ai): $0, never a model plan.
  "studio.image.ocr",
  "studio.image.aesthetic",
  "guardrails.local-safety",
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
  const out = new Set<string>([PREMIUM, OPUS, WORKHORSE, ECONOMY, ...Object.keys(FALLBACKS)]);
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
