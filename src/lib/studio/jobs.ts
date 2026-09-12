// The Studio job contract shared by the browser and the server: what a
// generation request contains and what a finished job returns. Pure + zod.
import { z } from "zod";
import type { PlatformId } from "@/lib/social-platforms";
import type { AspectRatio } from "./aspect";
import type { StageId, StudioType } from "./formats";

export const PlatformIdSchema = z.enum([
  "linkedin",
  "twitter",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
]);

export const AspectRatioSchema = z.enum(["1:1", "4:5", "16:9", "9:16", "3:4", "4:3"]);

export const StudioTypeSchema = z.enum([
  "social",
  "image",
  "carousel",
  "video",
  "article",
  "script",
  "ad",
]);

export const GOALS = [
  { id: "awareness", label: "Awareness" },
  { id: "engagement", label: "Engagement" },
  { id: "leads", label: "Leads" },
  { id: "launch", label: "Launch" },
  { id: "education", label: "Education" },
  { id: "offer", label: "Offer" },
] as const;

export type GoalId = (typeof GOALS)[number]["id"];

export const ControlsSchema = z.object({
  platforms: z.array(PlatformIdSchema).max(7).default([]),
  ratio: AspectRatioSchema.optional(),
  tone: z.string().max(80).optional(),
  length: z.enum(["short", "standard", "long"]).optional(),
  slideCount: z.number().int().min(3).max(10).optional(),
  durationSec: z.number().int().min(4).max(90).optional(),
  videoResolution: z.enum(["480P", "720P", "1080P"]).optional(),
  audio: z.boolean().optional(),
  includeImage: z.boolean().optional(),
  cta: z.string().max(140).optional(),
});

export type StudioControls = z.infer<typeof ControlsSchema>;

export const IntentSchema = z.object({
  brief: z.string().trim().min(3).max(4000),
  goal: z.enum(["awareness", "engagement", "leads", "launch", "education", "offer"]).optional(),
  ideaId: z.string().max(80).optional(),
  ideaSource: z.string().max(40).optional(),
});

export type StudioIntent = z.infer<typeof IntentSchema>;

export const REFINE_PRESETS = [
  {
    id: "shorter",
    label: "Shorter",
    instruction: "Make it noticeably shorter without losing the point.",
  },
  {
    id: "hook",
    label: "Punchier hook",
    instruction: "Rewrite the opening so it stops the scroll — specific, surprising, no clichés.",
  },
  {
    id: "specific",
    label: "More specific",
    instruction:
      "Replace generic claims with concrete details, numbers, or examples from the brand context.",
  },
  {
    id: "proof",
    label: "Add proof",
    instruction:
      "Add one credible proof point: a result, a customer moment, or a clear demonstration.",
  },
  {
    id: "cta",
    label: "Stronger CTA",
    instruction: "End with one clear, low-friction call to action that fits the goal.",
  },
  {
    id: "tone",
    label: "Warmer tone",
    instruction: "Keep the substance but make the voice warmer and more human.",
  },
] as const;

export const RefineSchema = z.object({
  instruction: z.string().trim().min(2).max(600),
  preset: z.string().max(40).optional(),
  /** "all", a platform id, "slide:N", "variant:N", or "media". */
  target: z.string().max(40).default("all"),
});

export type StudioRefine = z.infer<typeof RefineSchema>;

/** Brand DNA sent by the client (it lives in the browser). Loosely typed, size-capped. */
export const BrandPayloadSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const CreateJobSchema = z.object({
  workspaceId: z.string().uuid(),
  type: StudioTypeSchema,
  idempotencyKey: z.string().min(8).max(120),
  intent: IntentSchema,
  controls: ControlsSchema,
  brand: BrandPayloadSchema,
  parentJobId: z.string().uuid().optional(),
  refine: RefineSchema.optional(),
  /** Regenerate: same brief, a new take. */
  regenerate: z.boolean().optional(),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/* ---------------- Outputs ---------------- */

export type SocialVariant = {
  platform: PlatformId;
  title: string;
  body: string;
  hashtags: string[];
  chars: number;
};

export type CarouselSlide = {
  heading: string;
  body: string;
  /** Optional visual direction for the designer / image model. */
  visual?: string;
};

export type ArticleOutput = {
  title: string;
  dek: string;
  metaDescription: string;
  markdown: string;
  takeaways: string[];
  wordCount: number;
};

export type ScriptBeat = {
  time: string;
  visual: string;
  voiceover: string;
  onScreen?: string;
};

export type ScriptOutput = {
  title: string;
  hook: string;
  beats: ScriptBeat[];
  cta: string;
  caption: string;
  durationSec: number;
};

export type AdVariant = {
  label: string;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};

export type MediaOutput = {
  slot: string;
  kind: "image" | "video";
  ratio: AspectRatio;
  status: "pending" | "ready" | "failed";
  assetId?: string;
  storagePath?: string;
  /** Short-lived signed URL, refreshed on every job read. Never persisted. */
  url?: string;
  error?: string;
};

export type StudioJobOutput = {
  title?: string;
  angle?: string;
  variants?: SocialVariant[];
  slides?: CarouselSlide[];
  article?: ArticleOutput;
  script?: ScriptOutput;
  ads?: AdVariant[];
  /** Image/video: the visual concept the render was built from. */
  concept?: string;
  altText?: string;
  /** Ad: the shared visual direction. */
  visualConcept?: string;
  media?: MediaOutput[];
  /** Per-part failures that did not fail the whole job. */
  partial?: { target: string; error: string }[];
  warnings?: string[];
};

export type StudioJobError = { category: string; message: string; retryable: boolean };

export type StudioJob = {
  id: string;
  workspace_id: string;
  type: StudioType;
  status: JobStatus;
  stage: StageId;
  stage_at: string;
  title: string | null;
  input: Omit<CreateJobInput, "brand" | "workspaceId">;
  output: StudioJobOutput;
  error: StudioJobError | null;
  group_id: string;
  parent_job_id: string | null;
  content_item_ids: string[];
  asset_ids: string[];
  attempt: number;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export function isActiveJob(job: Pick<StudioJob, "status">): boolean {
  return job.status === "queued" || job.status === "running";
}

export function newIdempotencyKey(): string {
  return `studio-${crypto.randomUUID()}`;
}

export type { StudioType };
