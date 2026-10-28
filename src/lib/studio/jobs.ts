// The Studio job contract shared by the browser and the server: what a
// generation request contains and what a finished job returns. Pure + zod.
import { z } from "zod";
import type { PlatformId } from "@/lib/social-platforms";
import type { AspectRatio } from "./aspect";
import type { StageId, StudioType } from "./formats";
import type { StoryFrame } from "@/lib/stories/frames";
import type { VisualSnapshot } from "@/lib/brand-visuals/contracts";

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
  "story",
]);

export const GOALS = [
  { id: "awareness", label: "Reach more people" },
  { id: "engagement", label: "Get comments & likes" },
  { id: "leads", label: "Get new customers" },
  { id: "launch", label: "Announce something" },
  { id: "education", label: "Teach something" },
  { id: "offer", label: "Promote a deal" },
] as const;

export type GoalId = (typeof GOALS)[number]["id"];

export const ControlsSchema = z.object({
  paymentSource: z.enum(["creation", "credits"]).optional(),
  paymentSourceExplicit: z.boolean().optional(),
  articleQuality: z.enum(["standard", "premium"]).optional(),
  artworkMode: z.enum(["template", "full"]).optional(),
  platforms: z.array(PlatformIdSchema).max(7).default([]),
  ratio: AspectRatioSchema.optional(),
  tone: z.string().max(80).optional(),
  length: z.enum(["short", "standard", "long"]).optional(),
  slideCount: z.number().int().min(3).max(10).optional(),
  /** Carousel: draw the slides as one long connected picture that loops. */
  seamless: z.boolean().optional(),
  durationSec: z.number().int().min(4).max(90).optional(),
  videoResolution: z.enum(["480P", "720P", "1080P"]).optional(),
  videoModelKey: z
    .enum(["standard", "draft", "premium", "long", "cinematic", "variation"])
    .optional(),
  videoQuote: z
    .object({
      hash: z.string().length(64),
      units: z.number().int().positive(),
      resolution: z.enum(["480p", "720p", "768p", "1080p", "2k"]).optional(),
      aspectRatio: AspectRatioSchema.optional(),
    })
    .optional(),
  audio: z.boolean().optional(),
  includeImage: z.boolean().optional(),
  cta: z.string().max(140).optional(),
  /** Story: designed frames (default) or one vertical AI video. */
  storyMode: z.enum(["frames", "video"]).optional(),
  /** Story: how many frames, 1 to 7. */
  frameCount: z.number().int().min(1).max(7).optional(),
  /** Story: the theme from the content mix (src/lib/stories/frames.ts). */
  storyTheme: z.string().max(24).optional(),
  /** Story: Instagram usernames to tag (no @). */
  mentions: z.array(z.string().max(31)).max(5).optional(),
  /** Build a still storyboard before spending video credits. */
  videoPreview: z.boolean().optional(),
  campaign: z.string().trim().max(120).optional(),
  /** Explicit source photos selected for this generation, checked against this workspace. */
  referenceAssetIds: z.array(z.string().uuid()).max(4).optional(),
  /** Whether source photos stay intact, receive a targeted edit, or only inspire a new image. */
  referenceMode: z.enum(["preserve", "edit", "inspire"]).optional(),
  /** A product from the brand's catalogue (ADR-0035), checked against this workspace. */
  productId: z.string().uuid().optional(),
});

export type StudioControls = z.infer<typeof ControlsSchema>;

/** Snapshot of the reviewed script, independent of brief and content-row limits. */
export const SourceScriptSchema = z.object({
  title: z.string().max(120),
  hook: z.string().max(200),
  beats: z
    .array(
      z.object({
        time: z.string().max(20),
        visual: z.string().max(240),
        voiceover: z.string().max(320),
        onScreen: z.string().max(90).optional(),
      }),
    )
    .min(1)
    .max(12),
  cta: z.string().max(160),
  caption: z.string().max(10000),
  durationSec: z.number().int().min(4).max(60),
});

export const IntentSchema = z.object({
  brief: z.string().trim().min(3).max(4000),
  goal: z.enum(["awareness", "engagement", "leads", "launch", "education", "offer"]).optional(),
  ideaId: z.string().max(80).optional(),
  ideaSource: z.string().max(40).optional(),
  /** A running Autopilot program must still be active before each paid step. */
  autopilotProgramId: z.string().uuid().optional(),
  /** A StudioTemplate id; the prompt follows its structure. */
  template: z.string().max(40).optional(),
  /**
   * Decided by a plan before the piece is made (Autopilot): what it is for
   * (viral.ts) and how it opens (memory.ts). Studio follows them instead of
   * rotating on its own, so the piece is the one that was planned.
   */
  aim: z.enum(["save", "send", "reply", "relate", "act"]).optional(),
  hookStyle: z.string().max(24).optional(),
  /**
   * Repurpose: an existing content item this piece is made from (a post turned
   * into a Story). Read on the server through the job's own workspace.
   */
  sourceContentId: z.string().uuid().optional(),
  sourceScript: SourceScriptSchema.optional(),
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
    label: "Better opening",
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
    label: "Clearer next step",
    instruction: "End with one clear, low-friction call to action that fits the goal.",
  },
  {
    id: "tone",
    label: "Friendlier",
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

export const CreateJobSchema = z
  .object({
    workspaceId: z.string().uuid(),
    type: StudioTypeSchema,
    idempotencyKey: z.string().min(8).max(120),
    includedCaptionEdit: z.boolean().optional(),
    intent: IntentSchema,
    controls: ControlsSchema,
    brand: BrandPayloadSchema,
    /**
     * Brand Kit Style: a style id, "none" for Brand DNA only, or absent for the
     * workspace default. Checked on the server against the job's workspace.
     */
    parentJobId: z.string().uuid().optional(),
    refine: RefineSchema.optional(),
    /** Regenerate: same brief, a new take. */
    regenerate: z.boolean().optional(),
    /** The user already approved the draft this comes from: land the result in Ready. */
    approve: z.boolean().optional(),
    /** A text draft being turned into this post; retired once the post is ready. */
    fromContentId: z.string().uuid().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.controls.paymentSource === "creation" && input.controls.platforms.length > 3)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["controls", "platforms"],
        message: "Choose up to three platform versions for one creation.",
      });
    if (
      ["social", "image", "ad"].includes(input.type) &&
      (input.controls.referenceMode ?? "preserve") === "preserve" &&
      (input.controls.referenceAssetIds?.length ?? 0) > 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["controls", "referenceAssetIds"],
        message:
          "Choose one photo to keep unchanged, or switch to Edit or Inspire for multiple references.",
      });
    }
    if (
      (input.type === "video" ||
        (input.type === "story" && input.controls.storyMode === "video")) &&
      (input.controls.durationSec ?? 10) > 60
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["controls", "durationSec"],
        message: "Videos can be up to 60 seconds long.",
      });
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
  /** The slide's job in the story (src/lib/studio/carousel/story.ts). */
  role?: "cover" | "context" | "point" | "proof" | "recap" | "cta";
  /** A short label above the heading: "Step 2", "Myth", "The fix". */
  kicker?: string;
  /** Words from the heading to highlight. */
  emphasis?: string;
};

/** A Story: its frames and the look they share (the carousel design system). */
export type StoryOutput = {
  mode: "frames" | "video";
  theme: string;
  frames: StoryFrame[];
  /** How the frames look; absent for a video Story. */
  spec?: CarouselSpecOutput;
  /** Instagram usernames tagged on the Story. */
  mentions?: string[];
  /** The content item it was made from, if repurposed. */
  sourceContentId?: string;
};

/** How a carousel looks: chosen on the server, stored with the job and its drafts. */
export type CarouselSpecOutput = {
  /** The story structure id (steps, myths, story…). */
  structure?: string;
  design: { v: 1; look: string; colorway: string; motif: string; flow?: string };
  theme: {
    bg: string;
    ink: string;
    muted: string;
    accent: string;
    accentInk: string;
    surface: string;
    line: string;
    headingFont: string;
    bodyFont: string;
  };
  brand: string;
  site?: string;
  ratio?: string;
};

export type ArticleOutput = {
  title: string;
  dek: string;
  metaDescription: string;
  markdown: string;
  takeaways: string[];
  wordCount: number;
  /** Published as a visible FAQ and FAQPage structured data. */
  faq?: { question: string; answer: string }[];
  slug?: string;
  category?: string;
  tags?: string[];
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
  visualTaste?: VisualSnapshot;
  artwork?: { headline: string; brandName: string; artStoragePath?: string };
  storyboard?: {
    status: "preview" | "rendering" | "ready";
    assetId?: string;
    storagePath?: string;
  };
  title?: string;
  angle?: string;
  variants?: SocialVariant[];
  slides?: CarouselSlide[];
  /** Carousel: the look every slide shares. */
  carousel?: CarouselSpecOutput;
  /** Story: frames, theme and look. */
  story?: StoryOutput;
  article?: ArticleOutput;
  script?: ScriptOutput;
  ads?: AdVariant[];
  /** Image/video: the visual concept the render was built from. */
  concept?: string;
  /** Exact short copy selected for an image layer, kept separate from art direction. */
  onImageText?: string;
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
  captionEditsRemaining?: number;
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
