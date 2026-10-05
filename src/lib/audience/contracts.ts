// Audience — shared shapes (browser-safe). Decision record: ADR-0031.
//
// Words: a "twin" is one audience group in code; the UI says "group". "Persona"
// is already taken twice (the account type and the Brand DNA entry).
import { z } from "zod";

/* ───────────────────────── groups ───────────────────────── */

export const TRAIT_KINDS = [
  "goal",
  "pain",
  "objection",
  "trigger",
  "channel",
  "language",
  "pattern",
] as const;
export type TraitKind = (typeof TRAIT_KINDS)[number];

/** Where a trait came from. `user` is never overwritten; `assumed` is a guess. */
export const TRAIT_SOURCES = [
  "user",
  "brand_dna",
  "website",
  "market",
  "competitor",
  "measured",
  "assumed",
] as const;
export type TraitSource = (typeof TRAIT_SOURCES)[number];

export const TraitSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(TRAIT_KINDS),
  text: z.string().trim().min(1).max(280),
  source: z.enum(TRAIT_SOURCES),
  confidence: z.number().min(0).max(1),
  url: z.string().url().max(500).optional(),
});
export type Trait = z.infer<typeof TraitSchema>;

export const MAX_TRAITS = 24;
export const MAX_TWINS = 6;
/** How many groups answer a check. More adds cost, not insight. */
export const MAX_PANEL_TWINS = 5;
export const OVERALL_SLUG = "overall";

export type TwinRow = {
  id: string;
  workspace_id: string;
  slug: string;
  kind: "group" | "overall";
  name: string;
  segment: string;
  summary: string;
  weight: number;
  profile: Trait[];
  origin: "brand_dna" | "user" | "generated" | "system";
  origin_ref: string | null;
  status: "active" | "archived";
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TwinView = {
  id: string;
  slug: string;
  kind: "group" | "overall";
  name: string;
  segment: string;
  summary: string;
  weight: number;
  traits: Trait[];
  origin: TwinRow["origin"];
  /** 0-100: how much of this group is known rather than guessed. */
  known: number;
  updatedAt: string;
};

/** What a person may change on a group. */
export const TwinInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  segment: z.string().trim().max(120).default(""),
  summary: z.string().trim().max(600).default(""),
  weight: z.number().int().min(1).max(100).default(50),
  traits: z
    .array(
      z.object({
        id: z.string().min(1).max(40).optional(),
        kind: z.enum(TRAIT_KINDS),
        text: z.string().trim().min(1).max(280),
      }),
    )
    .max(MAX_TRAITS)
    .default([]),
});
export type TwinInput = z.infer<typeof TwinInputSchema>;

/* ───────────────────────── scores ───────────────────────── */

export const DIMENSIONS = ["fit", "hook", "clarity", "trust", "cta"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Dimensions = Record<Dimension, number>;

export const DIMENSION_LABEL: Record<Dimension, string> = {
  fit: "Fits your audience",
  hook: "Opening",
  clarity: "Clear",
  trust: "Believable",
  cta: "Next step",
};

export const SUBJECT_KINDS = ["post", "carousel", "ad", "script", "concept"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const SubjectSchema = z.object({
  kind: z.enum(SUBJECT_KINDS),
  platform: z.string().trim().max(30).default(""),
  title: z.string().trim().max(300).default(""),
  body: z.string().trim().min(1).max(6000),
});
export type Subject = z.infer<typeof SubjectSchema>;

export type Confidence = "low" | "medium" | "high";

export type HeuristicNote = { id: string; level: "good" | "warn"; text: string };

export const STANCES = ["love", "like", "neutral", "skip", "dislike"] as const;
export type Stance = (typeof STANCES)[number];

/** One simulated person. Always shown as simulated, never as a real customer. */
export type Reaction = {
  twinId: string;
  twinName: string;
  who: string;
  stance: Stance;
  quote: string;
  wouldAct: boolean;
};

export type SegmentScore = { twinId: string; name: string; score: number; note: string };

export type PulseResult = {
  sentiment: { positive: number; neutral: number; negative: number };
  reactions: Reaction[];
  segments: SegmentScore[];
  strengths: string[];
  objections: string[];
  /** How many simulated people answered. */
  people: number;
};

/** Stored in `audience_predictions.result`. */
export type PredictionResult = {
  why: string;
  fixes: string[];
  notes: HeuristicNote[];
  confidence: Confidence;
  /** Measured posts behind the calibration applied (0 = none yet). */
  measuredPosts: number;
  /** The score before this workspace's real results adjusted it. */
  raw?: number;
  pulse?: PulseResult;
};

export type PredictionRow = {
  id: string;
  workspace_id: string;
  content_item_id: string | null;
  run_id: string | null;
  variant_index: number | null;
  subject: Subject;
  subject_hash: string;
  twins_fingerprint: string;
  depth: "score" | "pulse";
  platform: string;
  content_type: string;
  overall: number;
  dimensions: Dimensions;
  result: PredictionResult;
  score_version: number;
  calibrated: boolean;
  created_by: string | null;
  created_at: string;
};

export type PredictionView = {
  id: string;
  contentItemId: string | null;
  depth: "score" | "pulse";
  title: string;
  platform: string;
  overall: number;
  dimensions: Dimensions;
  why: string;
  fixes: string[];
  notes: HeuristicNote[];
  confidence: Confidence;
  measuredPosts: number;
  calibrated: boolean;
  pulse: PulseResult | null;
  createdAt: string;
};

/* ───────────────────────── runs ───────────────────────── */

export const RUN_KINDS = ["twins", "pulse", "tournament"] as const;
export type RunKind = (typeof RUN_KINDS)[number];
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type RunProgress = { done: number; total: number };

export type VariantDraft = { label: string; title: string; body: string };

export type RunInput = {
  subject?: Subject;
  contentType?: string;
  /** Versions supplied by the caller (e.g. video concepts). Empty = write them. */
  variants?: VariantDraft[];
  /** Opaque ids the caller maps results back to (same order as `variants`). */
  variantRefs?: string[];
};

export type TournamentVariant = {
  index: number;
  ref: string | null;
  label: string;
  title: string;
  body: string;
  isOriginal: boolean;
  overall: number;
  dimensions: Dimensions;
  /** Share of simulated people who picked this one, 0-100. */
  picked: number;
  why: string;
  rank: number;
};

export type TournamentOutput = {
  variants: TournamentVariant[];
  winnerIndex: number | null;
  /** True when the top two are within the margin of a guess. */
  tooClose: boolean;
  margin: number;
  summary: string;
  confidence: Confidence;
};

export type RunRow = {
  id: string;
  workspace_id: string;
  kind: RunKind;
  status: RunStatus;
  stage: string;
  progress: RunProgress;
  input: RunInput;
  state: Record<string, unknown>;
  output: Record<string, unknown>;
  content_item_id: string | null;
  idempotency_key: string;
  created_by: string | null;
  cancel_requested: boolean;
  attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type RunEventRow = {
  id: string;
  workspace_id: string;
  run_id: string;
  kind: string;
  summary: string;
  data: Record<string, unknown>;
  created_at: string;
};

export type RunView = {
  id: string;
  kind: RunKind;
  status: RunStatus;
  stage: string;
  progress: RunProgress;
  contentItemId: string | null;
  events: { kind: string; summary: string; at: string }[];
  error: string | null;
  prediction: PredictionView | null;
  tournament: TournamentOutput | null;
  createdAt: string;
};

export function isActiveRun(status: RunStatus): boolean {
  return status === "queued" || status === "running";
}

/* ───────────────────────── learning ───────────────────────── */

export type OutcomeRow = {
  id: string;
  workspace_id: string;
  prediction_id: string;
  content_item_id: string | null;
  platform: string;
  content_type: string;
  title: string;
  horizon: "d7";
  metrics: Record<string, number>;
  engagement: number;
  predicted: number;
  actual: number | null;
  delivered_at: string | null;
  measured_at: string;
};

export type CalibrationRow = {
  workspace_id: string;
  platform: string;
  content_type: string;
  n: number;
  bias: number;
  mae: number;
  learned: string[];
  updated_at: string;
};

export type OutcomeView = {
  id: string;
  title: string;
  platform: string;
  predicted: number;
  actual: number | null;
  views: number;
  measuredAt: string;
};

export type AccuracyView = {
  /** Posts with a real result. */
  measured: number;
  /** Of those, how many could be compared with the workspace's other posts. */
  compared: number;
  /** Average gap between predicted and actual, in points. NULL until compared. */
  averageGap: number | null;
  learned: string[];
  outcomes: OutcomeView[];
};

export type AudienceStatus = { enabled: boolean };

export type AudienceView = {
  twins: TwinView[];
  overall: TwinView | null;
  /** True when groups can be (re)built from Brand DNA. */
  canBuild: boolean;
  /** Editors and above may change groups and run checks. */
  canEdit: boolean;
  building: RunView | null;
  recent: PredictionView[];
  accuracy: AccuracyView;
};

/** Latest score per content item, only when it still matches the text. */
export type ScoreMap = Record<string, { overall: number; depth: "score" | "pulse" }>;
