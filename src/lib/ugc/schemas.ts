// Contracts for UGC Video Ads — validated at every API boundary and shared by
// the studio UI. Pure (zod only).
import { z } from "zod";
import {
  CREATOR_AGES,
  CREATOR_GENDERS,
  CREATOR_VIBES,
  FORMATS,
  LANGUAGES,
  OBJECTIVES,
  PLATFORMS,
  SETTINGS,
  TONES,
} from "./options";
import { UGC_MODEL_KEYS } from "./models";
import { STOCK_CREATOR_IDS } from "./creators";
import { UGC_FORMAT_IDS } from "./formats/formats";
import { HOOK_TEXT_PRESET_IDS } from "./hook-text";

const ids = <T extends { id: string }>(list: readonly T[]) =>
  list.map((o) => o.id) as [T["id"], ...T["id"][]];

const text = (max: number) => z.string().trim().max(max);

/** A brief's format: "auto", a library format (formats/formats.ts) or an old id. */
export const BRIEF_FORMAT_IDS = ["auto", ...UGC_FORMAT_IDS, ...ids(FORMATS)] as [
  string,
  ...string[],
];
const CONCEPT_FORMAT_IDS = [...UGC_FORMAT_IDS, ...ids(FORMATS)] as [string, ...string[]];

export const ProductFactSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/i),
  text: text(300).min(1),
  /** page = read from the product page; user = typed or confirmed by the user. */
  source: z.enum(["page", "user"]),
});
export type ProductFact = z.infer<typeof ProductFactSchema>;

export const ProductImageSchema = z.object({
  url: z.string().url().max(2048),
  alt: text(200).optional().default(""),
});

export const ProductSchema = z.object({
  name: text(160).min(1),
  brand: text(120).default(""),
  url: z.string().url().max(2048).nullable().default(null),
  description: text(2000).default(""),
  price: text(40).default(""),
  category: text(120).default(""),
  images: z.array(ProductImageSchema).max(12).default([]),
  facts: z.array(ProductFactSchema).max(40).default([]),
  benefits: z.array(text(200)).max(12).default([]),
  audienceHints: z.array(text(200)).max(8).default([]),
  useCases: z.array(text(200)).max(8).default([]),
});
export type Product = z.infer<typeof ProductSchema>;

export const BriefSchema = z.object({
  durationSec: z.number().int().min(4).max(60, "Videos can be up to 60 seconds long.").optional(),
  objective: z.enum(ids(OBJECTIVES)).default("sales"),
  platform: z.enum(ids(PLATFORMS)).default("tiktok"),
  /** "auto" lets Mellox pick from the formats that suit the brand. */
  format: z.enum(BRIEF_FORMAT_IDS).default("auto"),
  tone: z.enum(ids(TONES)).default("authentic"),
  language: z.enum(ids(LANGUAGES)).default("en"),
  audience: text(400).default(""),
  cta: text(80).default(""),
  creator: z
    .object({
      gender: z.enum(ids(CREATOR_GENDERS)).default("any"),
      age: z.enum(ids(CREATOR_AGES)).default("any"),
      vibe: z.enum(ids(CREATOR_VIBES)).default("friendly"),
      setting: z.enum(ids(SETTINGS)).default("auto"),
      /** A ready-made creator (src/lib/ugc/creators.ts). */
      characterId: z.enum(STOCK_CREATOR_IDS).optional(),
      /** One of the brand's own people (an Inspo "Person" asset), re-checked on the server. */
      personAssetId: z.string().uuid().optional(),
      /** A two-person format's other role (a ready-made creator); absent: picked by code. */
      partnerId: z.enum(STOCK_CREATOR_IDS).optional(),
    })
    .prefault({}),
  /** Hook text drawn on the finished video by code (src/lib/ugc/hook-text.ts). */
  hookText: z
    .object({
      enabled: z.boolean().default(true),
      /** Absent: the format's own preset. */
      preset: z.enum(HOOK_TEXT_PRESET_IDS).optional(),
    })
    .prefault({}),
  instructions: text(1000).default(""),
  /** Imported scripts skip concept generation, including when reopened. */
  scriptSource: z.literal("studio").optional(),
});
export type Brief = z.infer<typeof BriefSchema>;

export const SceneSchema = z.object({
  id: z.string().min(1).max(32),
  /** Seconds from the start of the clip. */
  start: z.number().min(0).max(60),
  end: z.number().min(0).max(60),
  shot: text(300).default(""),
  action: text(500).default(""),
  dialogue: text(400).default(""),
  productPlacement: text(300).default(""),
  /** Suggested caption to add in editing — never rendered into the video. */
  caption: text(120).default(""),
  /** Who speaks: a format role (A / B) or nobody. Absent on older scripts. */
  speaker: z.enum(["A", "B", "none"]).optional(),
  /** How the beat starts: the opening shot, a hard cut, a split screen, or the same take. */
  cut: z.enum(["open", "hard", "split", "continuous"]).optional(),
  /** The beat's job in the story. */
  role: z.enum(["hook", "setup", "turn", "payoff", "button"]).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScriptSchema = z.object({
  hook: text(200).min(1),
  scenes: z.array(SceneSchema).min(1).max(12),
  cta: text(160).default(""),
  /** Post caption and hashtags for publishing alongside the video. */
  postCaption: text(10000).default(""),
  hashtags: z.array(text(40)).max(10).default([]),
  factIds: z.array(z.string().max(32)).max(40).default([]),
  /** The library format this script was written for. */
  format: z.enum(UGC_FORMAT_IDS).optional(),
  /** The place, twist and opening pattern it used (formats/variant.ts). */
  variant: z
    .object({
      place: z.string().max(40),
      twist: z.string().max(40),
      hook: z.number().int().min(0).max(20),
    })
    .optional(),
  /** Hook text drawn on the video by code; a split preset writes "left / right". */
  onScreen: text(80).default(""),
  /** For a "reply" hook: the comment the video answers. */
  replyTo: text(120).default(""),
});
export type Script = z.infer<typeof ScriptSchema>;

export const ConceptSchema = z.object({
  id: z.string().min(1).max(32),
  title: text(120).min(1),
  angle: text(400).default(""),
  format: z.enum(CONCEPT_FORMAT_IDS),
  hooks: z.array(text(200).min(1)).min(1).max(5),
  whyItWorks: text(400).default(""),
  script: ScriptSchema,
  /** Claims the grounding check could not tie to a product fact. */
  warnings: z.array(text(300)).max(10).default([]),
});
export type Concept = z.infer<typeof ConceptSchema>;

const uuid = z.string().uuid();

export const ExtractProductBody = z.object({
  workspaceId: uuid,
  url: z.string().trim().min(4).max(2048),
});

export const CreateProjectBody = z.object({
  workspaceId: uuid,
  title: text(200).optional(),
  product: ProductSchema,
  brief: BriefSchema.prefault({}),
  script: ScriptSchema.optional(),
  referenceAssetIds: z.array(uuid).max(9).default([]),
});

export const UpdateProjectBody = z.object({
  workspaceId: uuid,
  title: text(200).optional(),
  product: ProductSchema.optional(),
  brief: BriefSchema.optional(),
  selectedConceptId: z.string().max(32).nullable().optional(),
  script: ScriptSchema.nullable().optional(),
  referenceAssetIds: z.array(uuid).max(9).optional(),
});

export const GenerateConceptsBody = z.object({
  workspaceId: uuid,
  /** Replace all concepts, or rewrite the current script with an instruction. */
  mode: z.enum(["concepts", "rewrite"]).default("concepts"),
  instruction: text(300).optional(),
  durationSec: z.number().int().min(4).max(60, "Videos can be up to 60 seconds long.").optional(),
});

export const StartRenderBody = z.object({
  workspaceId: uuid,
  projectId: uuid,
  /** Client-generated per click; a double submit returns the same render. */
  idempotencyKey: z.string().min(8).max(100),
  model: z
    .union([z.literal("auto"), z.enum(UGC_MODEL_KEYS as [string, ...string[]])])
    .default("auto"),
  durationSec: z.number().int().min(4).max(60, "Videos can be up to 60 seconds long.").default(10),
  aspectRatio: z.enum(["9:16", "1:1", "16:9", "4:3", "3:4"]),
  resolution: z.enum(["480p", "720p", "768p", "1080p", "2k"]),
  /** Assets (uploaded or product images) to show the model; filtered to the workspace. */
  referenceAssetIds: z.array(uuid).max(9).default([]),
});

export const WorkspaceQuery = z.object({ workspaceId: uuid });

export const RENDER_STATUSES = [
  "queued",
  "submitting",
  "processing",
  "persisting",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];
export const ACTIVE_RENDER_STATUSES: readonly RenderStatus[] = [
  "queued",
  "submitting",
  "processing",
  "persisting",
];

/** What the browser sees of a render. */
export type RenderView = {
  id: string;
  projectId: string;
  status: RenderStatus;
  model: string;
  modelName: string;
  durationSec: number;
  aspectRatio: string;
  resolution: string;
  hook: string;
  errorMessage: string | null;
  /** True once a failed/cancelled render's allowance hold was returned. */
  allowanceReturned: boolean;
  assetId: string | null;
  videoUrl: string | null;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
};

export type ReferenceImageView = { assetId: string; url: string | null; filename: string };

export type ProjectView = {
  id: string;
  title: string;
  productUrl: string | null;
  product: Product;
  brief: Brief;
  concepts: Concept[];
  selectedConceptId: string | null;
  script: Script | null;
  references: ReferenceImageView[];
  renders: RenderView[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  productName: string;
  thumbnailUrl: string | null;
  latestRender: Pick<RenderView, "id" | "status" | "videoUrl"> | null;
  updatedAt: string;
};

export type ModelView = {
  key: string;
  displayName: string;
  tier: "draft" | "standard" | "premium";
  description: string;
  durations: number[];
  imageDurations: number[] | null;
  nativeDurations?: number[];
  nativeImageDurations?: number[] | null;
  aspectRatios: string[];
  resolutions: string[];
  defaultResolution: string;
  nativeAudio: boolean;
  images: { mode: "references" | "first_frame"; max: number } | null;
  videoUnits: number;
};

export type AllowanceView = {
  plan: string;
  videos: { used: number; held: number; limit: number };
  activeRenders: number;
  maxConcurrent: number;
};
