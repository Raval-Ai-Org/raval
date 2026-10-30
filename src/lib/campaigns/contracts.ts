// Campaigns (ADR-0039): a planned run of posts and Stories with one purpose —
// a launch, an event, a season, a sale, a series. The person gives the brief
// (what it's about, the goal, the date, the link, their photos and clips); pure
// code lays out the phases, dates and formats; a model only writes the ideas;
// every piece is then made through the same Studio → approval → scheduler path
// as everything else in Mellox.
//
// Shapes shared by the browser and the server. Pure: no I/O.
import { z } from "zod";
import type { PlatformId } from "@/lib/social-platforms";
import type { ShareAimId } from "@/lib/studio/viral";
import type { StoryThemeId } from "@/lib/stories/frames";

export const CAMPAIGN_STATUSES = ["draft", "ready", "running", "paused", "done", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** What the campaign is for. The number next to it is always the person's own. */
export const CAMPAIGN_GOAL_KINDS = [
  "registrations",
  "sales",
  "signups",
  "leads",
  "bookings",
  "followers",
  "reach",
  "engagement",
] as const;
export type CampaignGoalKind = (typeof CAMPAIGN_GOAL_KINDS)[number];

export const GOAL_LABELS: Record<CampaignGoalKind, string> = {
  registrations: "Registrations",
  sales: "Sales",
  signups: "Sign-ups",
  leads: "Leads",
  bookings: "Bookings",
  followers: "New followers",
  reach: "People reached",
  engagement: "Engagement",
};

/** How busy the campaign is: feed posts a week across its channels. */
export const CAMPAIGN_PACES = ["light", "steady", "push"] as const;
export type CampaignPace = (typeof CAMPAIGN_PACES)[number];
export const PACE_POSTS: Record<CampaignPace, number> = { light: 3, steady: 5, push: 8 };
export const PACE_LABELS: Record<CampaignPace, string> = {
  light: "Light",
  steady: "Steady",
  push: "Big push",
};

/** Studio formats a campaign piece can be. Articles stay in Studio. */
export const CAMPAIGN_FORMATS = ["social", "image", "carousel", "video", "story"] as const;
export type CampaignFormat = (typeof CAMPAIGN_FORMATS)[number];

/** What a photo or clip the person gave shows, so code can place it well. */
export const MEDIA_ROLES = ["hero", "detail", "people", "place", "event", "any"] as const;
export type MediaRole = (typeof MEDIA_ROLES)[number];

export const MAX_CAMPAIGN_MEDIA = 16;
export const MAX_CAMPAIGN_PIECES = 60;
export const MAX_CAMPAIGN_WEEKS = 12;
export const MAX_RUNNING_CAMPAIGNS = 6;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^\d{2}:\d{2}$/);
const platform = z.enum([
  "linkedin",
  "twitter",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
]);
const text = (max: number) => z.string().trim().max(max);

export const CampaignMediaSchema = z.object({
  assetId: z.string().uuid(),
  kind: z.enum(["image", "video"]),
  role: z.enum(MEDIA_ROLES).default("any"),
  label: text(80).default(""),
});
export type CampaignMedia = z.infer<typeof CampaignMediaSchema>;

export const CampaignGoalSchema = z.object({
  kind: z.enum(CAMPAIGN_GOAL_KINDS),
  /** The person's target. Never an estimate. */
  target: z.number().int().min(1).max(10_000_000).nullable().default(null),
  /** Where people should go: the form, the shop page, the booking page. */
  link: z.string().trim().url().max(600).nullable().default(null),
  /** What the link is, in a few words ("the sign-up form"). */
  linkLabel: text(40).default(""),
  /** The number the person typed in, and when. Mellox never writes it. */
  count: z.number().int().min(0).max(100_000_000).nullable().default(null),
  countAt: z.string().nullable().default(null),
});
export type CampaignGoal = z.infer<typeof CampaignGoalSchema>;

/** Everything the person told Mellox about the campaign. */
export const CampaignBriefSchema = z.object({
  type: z.string().min(2).max(40),
  name: text(80).min(1),
  /** What it's about, in the person's words. */
  about: text(800).default(""),
  /** The one thing people should remember. */
  keyMessage: text(240).default(""),
  /** The offer, with its real terms, if there is one. */
  offer: text(240).default(""),
  /** Facts the posts may use: speakers, venue, price, what's new. */
  facts: z.array(text(200)).max(12).default([]),
  /** The launch, event or sale day. Phases are laid out around it. */
  keyDate: ymd.nullable().default(null),
  startsOn: ymd,
  weeks: z.number().int().min(1).max(MAX_CAMPAIGN_WEEKS).default(3),
  channels: z.array(platform).min(1).max(5),
  pace: z.enum(CAMPAIGN_PACES).default("steady"),
  stories: z.boolean().default(true),
  timezone: z.string().min(1).max(60).default("UTC"),
  hashtag: text(40).default(""),
  tone: text(80).default(""),
  goal: CampaignGoalSchema,
  productIds: z.array(z.string().uuid()).max(3).default([]),
  media: z.array(CampaignMediaSchema).max(MAX_CAMPAIGN_MEDIA).default([]),
});
export type CampaignBrief = z.infer<typeof CampaignBriefSchema>;
export type CampaignBriefInput = z.input<typeof CampaignBriefSchema>;

/** One planned piece. Dates, channel, format, aim and opening are code's choice. */
export const CampaignPieceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  phase: z.string().min(1).max(40),
  date: ymd,
  time: hm,
  platform,
  format: z.enum(CAMPAIGN_FORMATS),
  aim: z.enum(["save", "send", "reply", "relate", "act"]),
  hook: z.string().max(24),
  storyTheme: z.string().max(24).nullable().default(null),
  /** Written by the plan (or the person); empty until then. */
  title: text(120).default(""),
  idea: text(700).default(""),
  visual: text(300).default(""),
  /** Asset ids from the brief's media, placed by code. */
  mediaIds: z.array(z.string().uuid()).max(6).default([]),
  mediaMode: z.enum(["none", "design", "recap", "clips"]).default("none"),
  /** The person moved or rewrote it; a new plan keeps it as it is. */
  edited: z.boolean().default(false),
});
export type CampaignPiece = z.infer<typeof CampaignPieceSchema>;

export const CampaignPhaseSchema = z.object({
  id: z.string().min(1).max(40),
  label: text(60),
  purpose: text(400),
  startsOn: ymd,
  endsOn: ymd,
});
export type CampaignPhase = z.infer<typeof CampaignPhaseSchema>;

export const CampaignPlanSchema = z.object({
  v: z.literal(1).default(1),
  /** The thread that runs through every piece. */
  bigIdea: text(300).default(""),
  phases: z.array(CampaignPhaseSchema).max(8),
  pieces: z.array(CampaignPieceSchema).max(MAX_CAMPAIGN_PIECES),
  /** True once a model has written the ideas (the paid step). */
  written: z.boolean().default(false),
  /** Bumped on every change after the campaign started. */
  rev: z.number().int().min(0).default(0),
});
export type CampaignPlan = z.infer<typeof CampaignPlanSchema>;

/* ───────────────────────── rows and views ───────────────────────── */

export type CampaignRow = {
  id: string;
  workspace_id: string;
  type: string;
  name: string;
  status: CampaignStatus;
  brief: Record<string, unknown>;
  plan: Record<string, unknown>;
  goal: Record<string, unknown>;
  starts_on: string;
  ends_on: string;
  key_date: string | null;
  version: number;
  acting_user_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
};

/** Where one piece is now, read from its Autopilot step and its post. */
export const PIECE_STATES = [
  "idea",
  "planned",
  "making",
  "waiting",
  "scheduled",
  "out",
  "missed",
  "failed",
  "cancelled",
] as const;
export type PieceState = (typeof PIECE_STATES)[number];

export type PieceView = CampaignPiece & {
  state: PieceState;
  actionId: string | null;
  contentIds: string[];
  /** Signed preview of the made picture, when there is one. */
  thumb: string | null;
  views: number | null;
  error: string | null;
};

export type CampaignProgress = {
  pieces: number;
  out: number;
  waiting: number;
  views: number | null;
  /** Posts that went out and were measured; null until one was. */
  measured: number;
};

export type CampaignView = {
  id: string;
  type: string;
  name: string;
  status: CampaignStatus;
  brief: CampaignBrief;
  plan: CampaignPlan;
  goal: CampaignGoal;
  startsOn: string;
  endsOn: string;
  keyDate: string | null;
  version: number;
  pieces: PieceView[];
  progress: CampaignProgress;
  updatedAt: string;
  /** Preview links for the brief's media, by asset id. Only on a single campaign read. */
  mediaUrls?: Record<string, string>;
};

/** A campaign worth running, found from what Mellox already knows. Free. */
export type CampaignSuggestion = {
  id: string;
  type: string;
  title: string;
  why: string;
  source: "moment" | "product" | "goal" | "opportunity" | "strategy" | "evergreen";
  brief: Partial<CampaignBriefInput>;
};

export type CampaignsHome = {
  campaigns: CampaignView[];
  suggestions: CampaignSuggestion[];
  /** Autopilot's everyday posts over the same weeks, for the timeline. */
  everyday: { date: string; platform: string; title: string }[];
  autopilot: { running: boolean; mode: string | null };
  canPlan: boolean;
  price: { plan: number; write: number };
};

/* ───────────────────────── helpers ───────────────────────── */

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === "string" && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/** Campaigns that are still going somewhere. */
export function isLive(status: CampaignStatus): boolean {
  return status === "running" || status === "paused";
}

export type { PlatformId, ShareAimId, StoryThemeId };
