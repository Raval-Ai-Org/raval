// Goals — what a brand wants its marketing to do (ADR-0035).
//
// Pure and browser-safe. One row per workspace in workspace_goals. Every
// number here is one a person typed; nothing in Mellox writes an estimate into
// it. A person's input reaches storage only through decideGoals (decide.ts).
import { z } from "zod";
import { PlatformIdSchema } from "@/lib/studio/jobs";

export const GOALS_VERSION = 1;

export const GOAL_FOCUSES = [
  "followers",
  "reach",
  "leads",
  "sales",
  "engagement",
  "launch",
] as const;
export type GoalFocus = (typeof GOAL_FOCUSES)[number];

export const GOAL_METRICS = [
  "followers",
  "subscribers",
  "reach",
  "leads",
  "sales",
  "engagement",
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const TIMEFRAMES = [4, 12, 26, 52] as const;
export type TimeframeWeeks = (typeof TIMEFRAMES)[number];

export const MAX_TARGET = 10_000_000;

export const GoalTargetSchema = z.object({
  metric: z.enum(GOAL_METRICS),
  /** Where the number is counted. Absent means across every channel. */
  platform: PlatformIdSchema.optional(),
  target: z.number().int().min(1).max(MAX_TARGET),
  /** Where the person says they are today ("you told us"), if they know. */
  baseline: z.number().int().min(0).max(MAX_TARGET).optional(),
});
export type GoalTarget = z.infer<typeof GoalTargetSchema>;

export const GoalsSchema = z.object({
  v: z.number().int().optional(),
  focus: z.enum(GOAL_FOCUSES),
  targets: z.array(GoalTargetSchema).max(3).default([]),
  timeframeWeeks: z.union([z.literal(4), z.literal(12), z.literal(26), z.literal(52)]),
  /** How many posts a week the person can look at and approve. */
  postsPerWeek: z.number().int().min(1).max(14),
  channels: z.array(PlatformIdSchema).max(5).default([]),
  /** When the goal was set (ISO). The timeframe counts from here. */
  startedAt: z.string().datetime(),
  /** A short note in the person's words, optional. */
  note: z.string().trim().max(240).default(""),
});
export type WorkspaceGoals = z.infer<typeof GoalsSchema>;

export type GoalsView = {
  goals: WorkspaceGoals | null;
  version: number;
  updatedAt: string | null;
};

export const FOCUS_LABELS: Record<GoalFocus, { label: string; hint: string }> = {
  followers: { label: "Grow my following", hint: "More people following the brand" },
  reach: { label: "Reach more people", hint: "More views on every post" },
  leads: { label: "Get new customers", hint: "Enquiries, sign-ups, bookings" },
  sales: { label: "Sell more", hint: "Orders from social and the site" },
  engagement: { label: "Start conversations", hint: "Comments, replies and shares" },
  launch: { label: "Launch something", hint: "Make a new product land" },
};

export const METRIC_LABELS: Record<GoalMetric, string> = {
  followers: "followers",
  subscribers: "subscribers",
  reach: "views",
  leads: "leads",
  sales: "sales",
  engagement: "comments and shares",
};

/** The metric a focus is measured by when the person gives a number. */
export const FOCUS_METRIC: Record<GoalFocus, GoalMetric> = {
  followers: "followers",
  reach: "reach",
  leads: "leads",
  sales: "sales",
  engagement: "engagement",
  launch: "reach",
};
