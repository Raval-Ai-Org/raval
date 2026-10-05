// Marketing Strategy — the one plan a workspace's marketing follows (ADR-0032).
//
// Pure and browser-safe. The model proposes the words; this file decides the
// shape, and ground.ts decides what may stay. One strategy per workspace,
// stored in workspace_marketing_strategy.
import { z } from "zod";
import { AUTOPILOT_GOALS } from "@/lib/autopilot/contracts";

export const STRATEGY_VERSION = 1;

const text = (max: number) => z.string().trim().max(max);
const need = (max: number) => z.string().trim().min(2).max(max);
const list = (max: number, len: number) => z.array(need(len)).max(max);

export const STRATEGY_STAGES = ["attract", "convince", "convert", "keep"] as const;
export type StrategyStage = (typeof STRATEGY_STAGES)[number];

export const STAGE_LABELS: Record<StrategyStage, string> = {
  attract: "Get noticed",
  convince: "Build trust",
  convert: "Get the sale",
  keep: "Keep them",
};

export const StrategySchema = z.object({
  v: z.number().int().optional(),
  positioning: z.object({
    /** One sentence: who it's for, what it does, why it's different. */
    statement: need(320),
    promise: text(200).default(""),
    differentiators: list(4, 140).default([]),
  }),
  goal: z.object({
    type: z.enum(AUTOPILOT_GOALS),
    summary: need(240),
    /** The one number to watch, in plain words ("Website enquiries"). */
    metric: text(80).default(""),
    target: text(80).default(""),
  }),
  audiences: z
    .array(z.object({ name: need(80), why: text(200).default(""), message: text(220).default("") }))
    .max(4)
    .default([]),
  voice: text(160).default(""),
  /** Content themes. `share` is the part of all posts each one gets (sums to 100). */
  pillars: z
    .array(
      z.object({
        title: need(60),
        detail: text(200).default(""),
        share: z.number().min(0).max(100),
      }),
    )
    .min(2)
    .max(5),
  channels: z
    .array(
      z.object({
        /** A platform id ("linkedin", "instagram"…) or "website" / "email". */
        platform: need(30),
        role: text(160).default(""),
        perWeek: z.number().int().min(0).max(21),
        formats: list(4, 30).default([]),
      }),
    )
    .max(6)
    .default([]),
  /** What to say at each stage of someone getting to know the brand. */
  messages: z.object({
    attract: text(240).default(""),
    convince: text(240).default(""),
    convert: text(240).default(""),
    keep: text(240).default(""),
  }),
  /** How to win against each tracked competitor. Ids come from the workspace. */
  competitors: z
    .array(
      z.object({
        competitorId: z.string().uuid(),
        name: need(80),
        theirAngle: text(220).default(""),
        ourEdge: need(260),
      }),
    )
    .max(5)
    .default([]),
  /** Moves the market invites right now. Each one keeps the source it came from. */
  plays: z
    .array(
      z.object({
        title: need(90),
        detail: text(260).default(""),
        sourceUrl: z.string().url().max(600),
        sourceTitle: text(160).default(""),
      }),
    )
    .max(5)
    .default([]),
  roadmap: z
    .array(z.object({ phase: need(40), focus: need(140), actions: list(4, 160).default([]) }))
    .max(3)
    .default([]),
  kpis: z
    .array(z.object({ label: need(60), target: text(60).default(""), why: text(160).default("") }))
    .max(5)
    .default([]),
  rules: z.object({ do: list(5, 160).default([]), dont: list(5, 160).default([]) }),
});
export type MarketingStrategy = z.infer<typeof StrategySchema>;

/** What a strategy may refer to: only things the workspace really has. */
export type StrategyFacts = {
  competitors: Array<{ id: string; name: string }>;
  /** Web sources Market Brain collected (the only links a play may cite). */
  sources: Array<{ url: string; title: string }>;
  /** Audience group names, when Audience is set up. */
  audiences: string[];
  /** Connected social platforms. */
  platforms: string[];
};

export type StrategyStatus = "draft" | "confirmed";

/** What the browser gets. */
export type StrategyView = {
  strategy: MarketingStrategy | null;
  status: StrategyStatus | null;
  version: number;
  generatedAt: string | null;
  confirmedAt: string | null;
  updatedAt: string | null;
  /** A brain changed after this was written; offer a rebuild, never do it alone. */
  stale: boolean;
  /** Which brains had something to give when it was written. */
  builtFrom: Record<"brand" | "audience" | "competitors" | "market", boolean>;
  /** What can feed a (re)build right now. */
  available: Record<"brand" | "audience" | "competitors" | "market", boolean>;
  canEdit: boolean;
  /** The next generate is included (no strategy has been generated yet). */
  nextIsFree: boolean;
};

/** JSON schema handed to the model (kept beside the zod shape it mirrors). */
export const STRATEGY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "positioning",
    "goal",
    "audiences",
    "voice",
    "pillars",
    "channels",
    "messages",
    "competitors",
    "plays",
    "roadmap",
    "kpis",
    "rules",
  ],
  properties: {
    positioning: {
      type: "object",
      additionalProperties: false,
      required: ["statement", "promise", "differentiators"],
      properties: {
        statement: { type: "string" },
        promise: { type: "string" },
        differentiators: { type: "array", items: { type: "string" } },
      },
    },
    goal: {
      type: "object",
      additionalProperties: false,
      required: ["type", "summary", "metric", "target"],
      properties: {
        type: { type: "string", enum: [...AUTOPILOT_GOALS] },
        summary: { type: "string" },
        metric: { type: "string" },
        target: { type: "string" },
      },
    },
    audiences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "why", "message"],
        properties: {
          name: { type: "string" },
          why: { type: "string" },
          message: { type: "string" },
        },
      },
    },
    voice: { type: "string" },
    pillars: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "share"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          share: { type: "number" },
        },
      },
    },
    channels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["platform", "role", "perWeek", "formats"],
        properties: {
          platform: { type: "string" },
          role: { type: "string" },
          perWeek: { type: "number" },
          formats: { type: "array", items: { type: "string" } },
        },
      },
    },
    messages: {
      type: "object",
      additionalProperties: false,
      required: [...STRATEGY_STAGES],
      properties: {
        attract: { type: "string" },
        convince: { type: "string" },
        convert: { type: "string" },
        keep: { type: "string" },
      },
    },
    competitors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["competitorId", "name", "theirAngle", "ourEdge"],
        properties: {
          competitorId: { type: "string" },
          name: { type: "string" },
          theirAngle: { type: "string" },
          ourEdge: { type: "string" },
        },
      },
    },
    plays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "sourceUrl", "sourceTitle"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          sourceUrl: { type: "string" },
          sourceTitle: { type: "string" },
        },
      },
    },
    roadmap: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["phase", "focus", "actions"],
        properties: {
          phase: { type: "string" },
          focus: { type: "string" },
          actions: { type: "array", items: { type: "string" } },
        },
      },
    },
    kpis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "target", "why"],
        properties: {
          label: { type: "string" },
          target: { type: "string" },
          why: { type: "string" },
        },
      },
    },
    rules: {
      type: "object",
      additionalProperties: false,
      required: ["do", "dont"],
      properties: {
        do: { type: "array", items: { type: "string" } },
        dont: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;
