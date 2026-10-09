// Autopilot contract shared by the browser and the server: what a person can
// set, and what the surface shows back. Pure + zod.
import { z } from "zod";
import { PlatformIdSchema } from "@/lib/studio/jobs";
import type { PlatformId } from "@/lib/social-platforms";
import type { StudioType } from "@/lib/studio/formats";
import {
  DEFAULT_STORY_SETTINGS,
  StorySettingsSchema,
  type StorySettings,
} from "@/lib/stories/schedule";

export { DEFAULT_STORY_SETTINGS, type StorySettings };

export const AUTOPILOT_MODES = ["assist", "autopilot", "full"] as const;
export type AutopilotMode = (typeof AUTOPILOT_MODES)[number];

export const MODE_INFO: Record<AutopilotMode, { label: string; detail: string }> = {
  full: {
    label: "Fully automatic",
    detail: "Posts that pass Mellox's checks go out by themselves. Anything unsure waits for you.",
  },
  autopilot: {
    label: "I approve each post",
    detail: "Mellox plans and writes. Nothing goes out until you say yes.",
  },
  assist: {
    label: "I approve the plan too",
    detail: "You OK the weekly plan first, then each post.",
  },
};

/** The brand strategy a program follows: proposed from Brand DNA, confirmed once. */
export const StrategySchema = z.object({
  summary: z.string().trim().max(400),
  audience: z.string().trim().max(240),
  voice: z.string().trim().max(160),
  pillars: z
    .array(
      z.object({ title: z.string().trim().min(2).max(60), detail: z.string().trim().max(200) }),
    )
    .max(5),
});
export type Strategy = z.infer<typeof StrategySchema>;

/** What Autopilot may create. Ads and scripts stay a hands-on job in Studio. */
export const AUTOPILOT_TYPES = ["social", "image", "carousel", "video", "article"] as const;
export type AutopilotType = (typeof AUTOPILOT_TYPES)[number];

/** What a planned piece can be: a feed post format, or a Story (Story Autopilot). */
export type PlanType = AutopilotType | "story";

/** Types that end as a scheduled social post. An article stops at "ready". */
export const PUBLISHABLE_TYPES: readonly StudioType[] = [
  "social",
  "image",
  "carousel",
  "video",
  "story",
];

export const AUTOPILOT_GOALS = [
  "awareness",
  "leads",
  "sales",
  "engagement",
  "trust",
  "launch",
] as const;
export type AutopilotGoal = (typeof AUTOPILOT_GOALS)[number];

/**
 * Work beyond the weekly posts. Each one starts or uses a Mellox system that
 * already exists and keeps that system's own rules.
 */
export const AUTOMATIONS = ["geo_scan", "repurpose", "publish_articles", "weekly_report"] as const;
export type Automation = (typeof AUTOMATIONS)[number];

/** The ones that run as a step of their own every week. */
export const WEEKLY_AUTOMATIONS: readonly Automation[] = ["geo_scan", "repurpose", "weekly_report"];

/** What a new program runs. Sending to a website is always a person's choice. */
export const DEFAULT_AUTOMATIONS: Automation[] = ["geo_scan", "repurpose", "weekly_report"];

export const AUTOMATION_INFO: Record<Automation, { label: string; detail: string }> = {
  geo_scan: {
    label: "AI visibility check",
    detail: "Scans your site every week and lines up fixes.",
  },
  repurpose: {
    label: "Reuse what worked",
    detail: "Each week your best post comes back in a new format.",
  },
  publish_articles: {
    label: "Articles to your website",
    detail: "An article you approve is sent to your blog.",
  },
  weekly_report: {
    label: "Weekly summary email",
    detail: "What went out, how it did and what needs you.",
  },
};

export function isAutomation(value: unknown): value is Automation {
  return typeof value === "string" && (AUTOMATIONS as readonly string[]).includes(value);
}

export const DURATION_WEEKS = [2, 4, 8, 12] as const;

export const ProgramSettingsSchema = z
  .object({
    mode: z.enum(AUTOPILOT_MODES),
    goal: z.enum(AUTOPILOT_GOALS),
    goalNote: z.string().trim().max(600).default(""),
    platforms: z.array(PlatformIdSchema).min(1).max(5),
    contentTypes: z.array(z.enum(AUTOPILOT_TYPES)).min(1).max(5),
    /** 0 when the program only makes Stories. */
    postsPerWeek: z.number().int().min(0).max(14),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    timezone: z.string().min(1).max(64),
    weeks: z.number().int().min(1).max(52),
    creditCapPerWeek: z.number().int().min(0).max(100_000),
    videoCapPerWeek: z.number().int().min(0).max(50).default(0),
    actOnOpportunities: z.boolean().default(false),
    strategy: StrategySchema.nullish(),
    automations: z.array(z.enum(AUTOMATIONS)).max(8).default(["geo_scan"]),
    /** Story Autopilot: daily Stories alongside (or instead of) feed posts. */
    stories: StorySettingsSchema.default(DEFAULT_STORY_SETTINGS),
  })
  .refine((s) => s.postsPerWeek > 0 || s.stories.enabled, {
    message: "Choose at least one post a week, or turn on daily Stories.",
    path: ["postsPerWeek"],
  });
export type ProgramSettings = z.infer<typeof ProgramSettingsSchema>;

export type ProgramStatus = "running" | "paused" | "completed" | "stopped";
export type ActionKind = "plan" | "content" | "scan" | "task";
export type ActionStatus =
  | "proposed"
  | "planned"
  | "generating"
  | "needs_approval"
  | "approved"
  | "scheduled"
  | "published"
  | "measured"
  | "done"
  | "skipped"
  | "missed"
  | "rejected"
  | "failed"
  | "cancelled";

export type OpportunityKind =
  "trend" | "competitor" | "news" | "customer" | "performance" | "visibility";

/** Something Autopilot needs before it can do its job, and where to fix it. */
export type ReadinessItem = {
  id: "brand" | "style" | "accounts" | "website" | "blog" | "audience" | "competitors" | "market";
  ok: boolean;
  label: string;
  detail: string;
  /** What the button says when it is not ready. */
  cta: string;
  /** Blocks posting (accounts) rather than just limiting what Autopilot can do. */
  required: boolean;
};
/** The brains a piece is built from besides Brand DNA; each is optional. */
export const BRAIN_READINESS: readonly ReadinessItem["id"][] = [
  "audience",
  "competitors",
  "market",
];

export type OpportunityStatus = "new" | "accepted" | "dismissed" | "expired" | "done";

/** What an opportunity can be turned into. A campaign is three linked pieces. */
export const OPPORTUNITY_FORMATS = [...AUTOPILOT_TYPES, "story", "campaign"] as const;
export type OpportunityFormat = (typeof OPPORTUNITY_FORMATS)[number];

export type Evidence = { title: string; url: string; date: string | null };

/* ───────────────────────── rows (as stored) ───────────────────────── */

export type ProgramRow = {
  id: string;
  workspace_id: string;
  status: ProgramStatus;
  pause_reason: string | null;
  mode: AutopilotMode;
  goal: string;
  goal_note: string;
  platforms: string[];
  content_types: string[];
  posts_per_week: number;
  weekdays: number[];
  timezone: string;
  starts_on: string;
  ends_on: string;
  credit_cap_per_week: number;
  video_cap_per_week: number;
  act_on_opportunities: boolean;
  acting_user_id: string | null;
  strategy: Record<string, unknown>;
  automations: string[];
  /** Story Autopilot settings (StorySettingsSchema); `{}` = off. */
  stories: Record<string, unknown>;
  last_notified_at: string | null;
  cycle: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type ActionRow = {
  id: string;
  workspace_id: string;
  program_id: string | null;
  kind: ActionKind;
  status: ActionStatus;
  dedupe_key: string;
  cycle: number;
  slot: number | null;
  planned_for: string | null;
  platform: string | null;
  content_type: string | null;
  title: string;
  brief: string;
  reason: string;
  goal: string | null;
  opportunity_id: string | null;
  requested_by: string | null;
  studio_job_id: string | null;
  content_item_ids: string[];
  generation_attempt: number;
  credits_charged: number;
  approved_by: string | null;
  approved_via: "user" | "auto" | null;
  result: Record<string, unknown>;
  next_attempt_at: string;
  lease_until: string | null;
  locked_by: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type OpportunityRow = {
  id: string;
  workspace_id: string;
  kind: OpportunityKind;
  title: string;
  summary: string;
  why_relevant: string;
  suggested_action: string;
  suggested_type: string;
  suggested_platforms: string[];
  evidence: Evidence[];
  source_kind: string;
  source_id: string | null;
  fingerprint: string;
  score: number;
  score_parts: Record<string, unknown>;
  status: OpportunityStatus;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  workspace_id: string;
  program_id: string | null;
  action_id: string | null;
  opportunity_id: string | null;
  kind: string;
  summary: string;
  data: Record<string, unknown>;
  actor: "system" | "user";
  actor_id: string | null;
  created_at: string;
};

/* ───────────────────────── views (what the UI gets) ───────────────────────── */

export type ProgramView = {
  id: string;
  status: ProgramStatus;
  pauseReason: string | null;
  mode: AutopilotMode;
  goal: string;
  goalNote: string;
  platforms: PlatformId[];
  contentTypes: AutopilotType[];
  postsPerWeek: number;
  weekdays: number[];
  timezone: string;
  startsOn: string;
  endsOn: string;
  creditCapPerWeek: number;
  videoCapPerWeek: number;
  actOnOpportunities: boolean;
  strategy: Strategy | null;
  automations: Automation[];
  stories: StorySettings;
  week: number;
  totalWeeks: number;
};

export type ActionPreview = {
  contentItemId: string;
  status: string;
  title: string;
  body: string;
  mediaUrl: string | null;
  channel: string | null;
  /** A Story's drawn frames, in order (signed URLs). */
  frames?: string[];
  /** The Mellox Score for this exact text (Audience), when there is one. */
  score?: number | null;
};

export type ActionView = {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  plannedFor: string | null;
  platform: string | null;
  contentType: string | null;
  title: string;
  brief: string;
  reason: string;
  opportunityId: string | null;
  contentItemIds: string[];
  creditsCharged: number;
  approvedVia: "user" | "auto" | null;
  error: string | null;
  metrics: Record<string, number> | null;
  updatedAt: string;
  /** When the worker next touches it: writes it, schedules it, checks on it. */
  nextStepAt: string | null;
  /** The brand theme it sits under, when the plan gave it one. */
  pillar?: string | null;
  /** What it was built from: "Brand DNA", "For: Agency owners"… */
  builtFrom?: string[];
  preview?: ActionPreview | null;
};

export type OpportunityView = {
  id: string;
  kind: OpportunityKind;
  title: string;
  summary: string;
  why: string;
  suggestedAction: string;
  suggestedType: OpportunityFormat;
  suggestedPlatforms: PlatformId[];
  evidence: Evidence[];
  score: number;
  status: OpportunityStatus;
  createdAt: string;
  expiresAt: string;
};

export type EventView = {
  id: string;
  kind: string;
  summary: string;
  actor: "system" | "user";
  actionId: string | null;
  createdAt: string;
};

export type WeekNumbers = {
  /** Pieces that went out. */
  posted: number;
  /** Views counted so far on those pieces. */
  views: number;
  /** How many of them went out without a person (Fully automatic). */
  auto: number;
};

export type AutopilotBudget = {
  creditsUsed: number;
  creditCap: number;
  videosUsed: number;
  videoCap: number;
};

export type AutopilotView = {
  enabled: true;
  fullAvailable: boolean;
  canEdit: boolean;
  canManage: boolean;
  program: ProgramView | null;
  budget: AutopilotBudget | null;
  /** Assist mode: a plan waiting for a yes. */
  proposed: ActionView[];
  approvals: ActionView[];
  upcoming: ActionView[];
  finished: ActionView[];
  failed: ActionView[];
  opportunities: OpportunityView[];
  events: EventView[];
  connectedPlatforms: PlatformId[];
  readiness: ReadinessItem[];
  /** What Autopilot learned from its own results, used in the next plan. */
  learnings: string[];
  /** Recurring non-post work: latest run of each. */
  tasks: ActionView[];
  /** When the next week gets planned; null when no plan is queued. */
  nextPlanAt: string | null;
  visibility: { score: number | null; scannedAt: string | null } | null;
  /** The blog approved articles go to, when one is set up. */
  site: { host: string } | null;
  /** The last seven days in numbers. */
  week: WeekNumbers;
  /** Story Autopilot at a glance: what's coming and when it goes out. */
  stories: {
    enabled: boolean;
    /** Today's and the next days' Story times in the program's time zone. */
    times: string[];
    /** "learned": from this brand's own Stories; "common": typical peaks. */
    timing: "learned" | "common" | "even";
    upcoming: number;
    waiting: number;
  } | null;
};

/** What Mellox proposes at setup, so the person only has to say yes. */
export type StrategySuggestion = {
  strategy: Strategy;
  settings: ProgramSettings;
  /** "model" when written from Brand DNA; "basic" when a safe default was used. */
  source: "model" | "basic";
  hasBrand: boolean;
};

export type AgencyAutopilotRow = {
  workspaceId: string;
  programId: string | null;
  status: ProgramStatus | null;
  pauseReason: string | null;
  mode: AutopilotMode | null;
  endsOn: string | null;
  needsApproval: number;
  planWaiting: number;
  newOpportunities: number;
  failures: number;
  missed: number;
  performanceWarnings: number;
  nextActionAt: string | null;
  nextActionTitle: string | null;
};

export function isAutopilotType(value: unknown): value is AutopilotType {
  return typeof value === "string" && (AUTOPILOT_TYPES as readonly string[]).includes(value);
}
