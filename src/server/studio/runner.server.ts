// runner.server.ts — executes Studio jobs.
//
//   create → context → text (LLM) → drafts → [provider render tasks] → succeeded
//
// Text runs inline in the create request (tens of seconds). Image/video renders
// are started at the provider and advanced by `advanceStudioJob` on each poll,
// so no request waits on a render and the job survives navigation. Every write
// goes through the caller's RLS client except asset storage (service role, in
// persist.server.ts).
import { humanizeOutput } from "@/lib/studio/humanize";
import { naturalizeVariants } from "@/lib/studio/naturalize.server";
import "server-only";
import { after } from "next/server";
import sharp from "sharp";
import { isAudienceAutoScoreEnabled } from "@/lib/feature-flags";
import { getRequestScope } from "@/server/request-context";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runStructuredPrompt, AiOutputError, AiGatewayError } from "@/lib/ai";
import { BudgetExceededError, enforceBudget } from "@/server/ai/budget";
import { recordUsage } from "@/server/ai/metering";
import { UpstreamError } from "@/server/upstream";
import {
  checkImageTask,
  isImageTask,
  startImageTask,
  type ImageSize,
} from "@/lib/openrouter-image.server";
import type { UgcAspectRatio, UgcResolution } from "@/lib/ugc/models";
import { activeModel } from "@/server/ugc/models.server";
import { routedVideoProvider } from "@/server/ugc/providers/routed.server";
import { linkAssetToContent, persistAsset, signAssetPath } from "@/server/assets/persist.server";
import { mergeAddedPlatforms } from "@/lib/studio/add-platforms";
import {
  buildImagePromptDetailed,
  logoCorner,
  type BrandDnaLite,
  type ImageStyleInput,
} from "@/lib/post-image";
import { overlayBrandLogo, type LogoCorner } from "@/server/studio/logo-overlay.server";
import { loadBrandLook, type LoadedLook } from "@/server/brand-look/resolve.server";
import {
  imageStyleInput,
  styleProtectedTerms,
  videoStyleBlock,
  writingStyleBlock,
} from "@/lib/brand-look/prompt";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { canTransitionContent, isContentStatus, mergeMeta } from "@/lib/content-lifecycle";
import {
  IMAGE_SIZE_BY_RATIO,
  RATIOS,
  recommendedRatio,
  type AspectRatio,
} from "@/lib/studio/aspect";
import {
  STUDIO_FORMATS,
  channelForPlatform,
  type StageId,
  type StudioType,
} from "@/lib/studio/formats";
import {
  buildCaptionPrompt,
  buildTextPrompt,
  completeVariants,
  countWords,
  finalizeVariant,
  finalizeVariants,
  pickAngle,
  scriptToMarkdown,
  type Angle,
  type StudioContext,
} from "@/lib/studio/prompts";
import type {
  CreateJobInput,
  MediaOutput,
  StudioJob,
  StudioJobError as JobErrorInfo,
  StudioJobOutput,
} from "@/lib/studio/jobs";
import { invalidateStudioContext, loadStudioContext } from "./context.server";
import { findRepeatedOpening, findSimilarRecent, hasResearchCitation } from "@/lib/studio/novelty";
import { pickHookStyle } from "@/lib/studio/memory";
import { AIM_ANGLES } from "@/lib/studio/viral";
import { normalizeSlides, pickCarouselStructure } from "@/lib/studio/carousel/story";
import {
  BACKDROP_RATIO,
  carouselTheme,
  isSeamless,
  pickCarouselDesign,
  safeDesign,
  safeTheme,
  type CarouselDesign,
} from "@/lib/studio/carousel/design";
import { paletteFromDnaColors } from "@/lib/brand-look/resolve";
import type { CarouselSpecOutput } from "@/lib/studio/jobs";
import { linkGeneratedCarousel, storeCarouselSlides } from "./carousel-assets.server";
import { carouselRenderable } from "./carousel-render.server";
import { linkGeneratedStory } from "./story-assets.server";
import {
  framesFromMeta,
  normalizeFrames,
  pickStoryTheme,
  storyText,
  type StoryTheme,
} from "@/lib/stories/frames";
import { cleanMentions } from "@/lib/stories/placement";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { studioOutputQualityIssue } from "@/lib/studio/quality";
import { checkMemoryConformance } from "@/lib/memory/conformance";
import { loadMemories } from "@/server/memory/context.server";
import { reviewGeneratedImage } from "./image-review.server";
import {
  carouselBackdropPrompt,
  carouselSlidePrompt,
  storyFramePrompt,
} from "./visual-prompts.server";

/** The media slot of a connected carousel's one background picture. */
const BACKDROP_SLOT = "backdrop";
import { messageForStatus, userSafeMessage } from "@/lib/user-errors";

type Db = SupabaseClient;

const JOB_COLS =
  "id, workspace_id, type, status, stage, stage_at, title, input, output, error, provider_tasks, group_id, parent_job_id, content_item_ids, asset_ids, attempt, idempotency_key, created_at, updated_at, completed_at";

const RENDER_TIMEOUT_MS = 10 * 60_000;
const LEASE_MS = 90_000;
const MAX_VERSIONS = 5;

type ProviderTask = {
  slot: string;
  kind: "image" | "video";
  taskId: string;
  /** Who runs it: "openrouter" for images; the accepting provider for video. */
  provider?: string;
  model: string;
  fallbacks: string[];
  ratio: AspectRatio;
  prompt: string;
  referenceAssets?: string[];
  /** The workspace's real logo, drawn on by code once the image is finished. */
  logo?: { url: string; corner: LogoCorner };
  reviewAttempts?: number;
  startedAt: number;
  state: "pending" | "done" | "failed";
};

type JobRow = StudioJob & {
  provider_tasks: ProviderTask[];
  idempotency_key: string;
};

export class StudioJobError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/* ───────────────────────── helpers ───────────────────────── */

function db(client: unknown): Db {
  return client as Db;
}

function classify(error: unknown): JobErrorInfo {
  if (error instanceof BudgetExceededError) {
    return { category: "budget", message: error.message, retryable: false };
  }
  if (error instanceof AiOutputError) {
    return {
      category: "output",
      message: "The model returned something unusable. Your brief is saved — try again.",
      retryable: true,
    };
  }
  if (error instanceof UpstreamError || error instanceof AiGatewayError) {
    const status = (error as { status?: number }).status ?? 502;
    console.warn("[studio] provider error", status, error.message);
    return {
      category: status === 429 ? "rate_limit" : status === 503 ? "configuration" : "provider",
      message: messageForStatus(status),
      retryable: status !== 400 && status !== 422 && status !== 503,
    };
  }
  if (error instanceof StudioJobError) {
    return { category: "request", message: userSafeMessage(error.message), retryable: false };
  }
  return {
    category: "unknown",
    message:
      error instanceof Error
        ? userSafeMessage(error.message, "Generation failed. Please try again.")
        : "Generation failed. Please try again.",
    retryable: true,
  };
}

async function patchJob(client: Db, id: string, patch: Record<string, unknown>) {
  const { error } = await client.from("studio_jobs").update(patch).eq("id", id);
  if (error) console.warn("[studio] job update failed", id, error.message);
}

async function setStage(client: Db, id: string, stage: StageId) {
  await patchJob(client, id, { stage, stage_at: new Date().toISOString() });
}

function brandVersion(brand: unknown): string {
  const text = JSON.stringify(brand ?? null);
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return `b${(h >>> 0).toString(36)}`;
}

function platformsFor(type: StudioType, requested: PlatformId[]): PlatformId[] {
  const format = STUDIO_FORMATS[type];
  if (!format.platforms.length) return [];
  const allowed = requested.filter((p) => format.platforms.includes(p));
  const picked = [...new Set(allowed.length ? allowed : format.defaultPlatforms)];
  return format.multiPlatform ? picked : picked.slice(0, 1);
}

function mediaRatio(type: StudioType, input: CreateJobInput, platforms: PlatformId[]): AspectRatio {
  const format = STUDIO_FORMATS[type];
  const requested = input.controls.ratio;
  if (requested && format.ratios.includes(requested)) return requested;
  if (type === "carousel") return "4:5";
  if (type === "story") return "9:16";
  return recommendedRatio(platforms, type === "video" ? "video" : "image", format.ratios);
}

function needsMedia(type: StudioType, input: CreateJobInput): boolean {
  if (type === "carousel" || type === "story") return true;
  const media = STUDIO_FORMATS[type].media;
  return (
    media === "image" ||
    media === "video" ||
    (media === "optional-image" && !!input.controls.includeImage)
  );
}

/* ───────────────────────── read ───────────────────────── */

/** Refresh short-lived signed URLs for ready media on every read. */
export async function presentJob(row: JobRow): Promise<StudioJob> {
  const { provider_tasks: _tasks, ...job } = row;
  const media = row.output?.media;
  if (!media?.length) return job;
  const signed = await Promise.all(
    media.map(async (m) =>
      m.status === "ready" && m.storagePath
        ? { ...m, url: (await signAssetPath(m.storagePath)) ?? undefined }
        : m,
    ),
  );
  return { ...job, output: { ...row.output, media: signed } };
}

export async function getJobRow(
  client: unknown,
  workspaceId: string,
  id: string,
): Promise<JobRow | null> {
  const { data, error } = await db(client)
    .from("studio_jobs")
    .select(JOB_COLS)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as JobRow | null) ?? null;
}

export async function listJobs(client: unknown, workspaceId: string): Promise<StudioJob[]> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data, error } = await db(client)
    .from("studio_jobs")
    .select(JOB_COLS)
    .eq("workspace_id", workspaceId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(error.message);
  return Promise.all(((data ?? []) as JobRow[]).map(presentJob));
}

/* ───────────────────────── drafts ───────────────────────── */

type DraftRow = {
  platform: PlatformId | null;
  kind: string;
  channel: string;
  title: string;
  body: string;
  hashtags: string[];
  meta: Record<string, unknown>;
};

function draftRows(type: StudioType, output: StudioJobOutput, platforms: PlatformId[]): DraftRow[] {
  const format = STUDIO_FORMATS[type];
  const title = (output.title || "Untitled").slice(0, 280);
  const base = { kind: format.kind, title };

  switch (type) {
    case "social":
    case "image":
    case "video":
      return (output.variants ?? []).map((v) => ({
        ...base,
        platform: v.platform,
        channel: channelForPlatform(v.platform),
        title: (v.title && v.title !== `${PLATFORMS[v.platform].label} post`
          ? v.title
          : title
        ).slice(0, 280),
        body: v.body,
        hashtags: v.hashtags,
        meta: {
          platform: v.platform,
          chars: v.chars,
          ...(output.concept ? { concept: output.concept } : {}),
        },
      }));
    case "carousel":
      return (output.variants ?? []).map((v) => ({
        ...base,
        platform: v.platform,
        channel: channelForPlatform(v.platform),
        body: v.body,
        hashtags: v.hashtags,
        meta: {
          platform: v.platform,
          slides: output.slides ?? [],
          ...(output.carousel ? { carousel: output.carousel } : {}),
        },
      }));
    case "story": {
      const story = output.story;
      const text = story?.frames.length
        ? storyText(story.frames)
        : (output.concept ?? title).slice(0, 600);
      return platforms.map((p) => ({
        ...base,
        platform: p,
        channel: channelForPlatform(p),
        body: text,
        hashtags: [],
        meta: {
          platform: p,
          placement: "stories",
          story: {
            mode: story?.mode ?? "frames",
            theme: story?.theme ?? null,
            frames: story?.frames ?? [],
            ...(story?.spec ? { spec: story.spec } : {}),
            mentions: p === "instagram" ? (story?.mentions ?? []) : [],
            ...(story?.sourceContentId ? { source_content_id: story.sourceContentId } : {}),
          },
          ...(output.concept ? { concept: output.concept } : {}),
        },
      }));
    }
    case "ad":
      return platforms.map((p) => ({
        ...base,
        platform: p,
        channel: channelForPlatform(p),
        body: output.ads?.[0]?.primaryText ?? "",
        hashtags: [],
        meta: { platform: p, ad_variants: output.ads ?? [] },
      }));
    case "script": {
      const p = platforms[0] ?? "instagram";
      const s = output.script!;
      return [
        {
          ...base,
          platform: p,
          channel: channelForPlatform(p),
          body: `${scriptToMarkdown(s)}\n\n---\n\n${s.caption}`,
          hashtags: [],
          meta: { platform: p, script: s },
        },
      ];
    }
    case "article": {
      const a = output.article!;
      return [
        {
          ...base,
          platform: null,
          channel: "blog",
          body: a.markdown,
          hashtags: [],
          meta: {
            article: {
              dek: a.dek,
              metaDescription: a.metaDescription,
              takeaways: a.takeaways,
              wordCount: a.wordCount,
              faq: a.faq ?? [],
              slug: a.slug ?? "",
              category: a.category ?? "",
              tags: a.tags ?? [],
            },
          },
        },
      ];
    }
  }
}

/** Walk a row to `pending` through legal transitions. */
function pathToPending(status: string): string[] | null {
  if (status === "pending") return [];
  if (!isContentStatus(status)) return null;
  if (canTransitionContent(status, "pending")) return ["pending"];
  if (canTransitionContent(status, "draft")) return ["draft", "pending"];
  return null;
}

/**
 * Create the group's content rows, or rewrite them in place for a
 * regenerate/refine (keeping a short version history). New rows start as
 * `draft` marked `studio_state: generating` and are revealed in Needs Approval
 * by `revealDrafts` once the job fully succeeds.
 */
async function writeDrafts(
  client: Db,
  job: JobRow,
  rows: DraftRow[],
  extraMeta: Record<string, unknown>,
  preserveExisting = false,
): Promise<string[]> {
  const format = STUDIO_FORMATS[job.type];
  const common = {
    studio_type: job.type,
    group_id: job.group_id,
    job_id: job.id,
    source: "studio",
    ...extraMeta,
  };

  const existingIds = job.content_item_ids ?? [];
  const existing = existingIds.length
    ? (((
        await client
          .from("content_items")
          .select("id, status, title, body, hashtags, meta")
          .in("id", existingIds)
          .eq("workspace_id", job.workspace_id)
      ).data ?? []) as Array<{
        id: string;
        status: string;
        title: string | null;
        body: string | null;
        hashtags: string[] | null;
        meta: unknown;
      }>)
    : [];

  const locked = existing.find((r) =>
    ["scheduled", "publishing", "published", "partial_failed"].includes(r.status),
  );
  if (locked) {
    throw new StudioJobError(
      409,
      "Part of this content is already scheduled or published. Unschedule it before regenerating.",
    );
  }

  const byPlatform = new Map(
    existing.map(
      (r) => [String((r.meta as Record<string, unknown> | null)?.platform ?? "none"), r] as const,
    ),
  );
  const ids: string[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    const key = row.platform ?? "none";
    const current = byPlatform.get(key);
    const meta = { ...common, ...row.meta };
    if (current) {
      byPlatform.delete(key);
      if (preserveExisting) {
        ids.push(current.id);
        continue;
      }
      const prevMeta = (current.meta as Record<string, unknown> | null) ?? {};
      const versions = Array.isArray(prevMeta.versions) ? (prevMeta.versions as unknown[]) : [];
      const nextVersions = [
        {
          title: current.title,
          body: current.body,
          hashtags: current.hashtags,
          job_id: prevMeta.job_id ?? null,
          at: now,
        },
        ...versions,
      ].slice(0, MAX_VERSIONS);
      const steps = pathToPending(current.status) ?? ["draft", "pending"];
      // Content first (keeps whatever status is legal), then walk to pending.
      const { error } = await client
        .from("content_items")
        .update({
          title: row.title,
          body: row.body,
          hashtags: row.hashtags,
          channel: row.channel,
          meta: mergeMeta(prevMeta, { ...meta, versions: nextVersions, studio_state: "ready" }),
          ...(steps[0] === "draft" ? { status: "draft" } : {}),
        })
        .eq("id", current.id);
      if (error) throw new Error(`Couldn't update draft: ${error.message}`);
      if (steps.includes("pending")) {
        await client.from("content_items").update({ status: "pending" }).eq("id", current.id);
      }
      ids.push(current.id);
    } else {
      const { data, error } = await client
        .from("content_items")
        .insert({
          workspace_id: job.workspace_id,
          agent: format.agent,
          kind: row.kind,
          channel: row.channel,
          title: row.title,
          body: row.body,
          hashtags: row.hashtags,
          status: "draft",
          meta: { ...meta, studio_state: "generating" },
        })
        .select("id")
        .single();
      if (error || !data)
        throw new Error(`Couldn't save draft: ${error?.message ?? "insert failed"}`);
      ids.push((data as { id: string }).id);
    }
  }

  // Platforms the user removed on regenerate: drop unapproved rows.
  const removable = [...byPlatform.values()].filter((r) =>
    ["draft", "pending", "rejected", "failed"].includes(r.status),
  );
  if (removable.length) {
    await client
      .from("content_items")
      .delete()
      .in(
        "id",
        removable.map((r) => r.id),
      );
  }
  return ids;
}

/**
 * Surface a finished group in the pipeline: in Review, or straight in Ready when
 * the user approved the draft it was made from.
 */
async function revealDrafts(client: Db, workspaceId: string, ids: string[], approve = false) {
  if (!ids.length) return;
  const { data } = await client
    .from("content_items")
    .select("id, status, meta")
    .in("id", ids)
    .eq("workspace_id", workspaceId);
  for (const row of (data ?? []) as Array<{ id: string; status: string; meta: unknown }>) {
    const meta = mergeMeta(row.meta, { studio_state: "ready" });
    const { error } = await client
      .from("content_items")
      .update({
        meta,
        ...(approve && (row.status === "draft" || row.status === "pending")
          ? { status: "approved" }
          : row.status === "draft"
            ? { status: "pending" }
            : {}),
      })
      .eq("id", row.id);
    if (error) console.warn("[studio] reveal failed", row.id, error.message);
  }
  scoreDraftsSoon(workspaceId, ids);
}

/**
 * Audience (ADR-0031): a quick score for what was just written, after the
 * response is sent. It reads the drafts and writes only its own table, so it
 * can never change a job, a draft or the job's charge. Any failure just means
 * there is no score yet.
 */
function scoreDraftsSoon(workspaceId: string, contentItemIds: string[]) {
  if (!isAudienceAutoScoreEnabled(workspaceId)) return;
  const userId = getRequestScope().userId ?? null;
  const run = () =>
    import("@/server/audience/service.server")
      .then((m) => m.autoScore({ workspaceId, userId, contentItemIds }))
      .catch(() => undefined);
  try {
    after(run);
  } catch {
    // No request to wait behind (a worker or a test): run it detached.
    void run();
  }
}

/** The text draft this post was made from: retire it now that the post exists. */
async function retireSourceDraft(
  client: Db,
  workspaceId: string,
  contentId: string | undefined,
  jobId: string,
) {
  if (!contentId) return;
  const { data } = await client
    .from("content_items")
    .select("id, status, meta")
    .eq("id", contentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const row = data as { id: string; status: string; meta: unknown } | null;
  if (!row) return;
  const meta = mergeMeta(row.meta, { converted_to_job: jobId, converting_job: null });
  // Lifecycle: draft → pending → rejected.
  if (row.status === "draft") {
    await client.from("content_items").update({ status: "pending" }).eq("id", row.id);
  }
  const retire = row.status === "draft" || row.status === "pending";
  const { error } = await client
    .from("content_items")
    .update({ meta, ...(retire ? { status: "rejected" } : {}) })
    .eq("id", row.id);
  if (error) console.warn("[studio] retire source draft failed", row.id, error.message);
}

async function markDraftsFailed(client: Db, workspaceId: string, ids: string[]) {
  if (!ids.length) return;
  const { data } = await client
    .from("content_items")
    .select("id, meta")
    .in("id", ids)
    .eq("workspace_id", workspaceId);
  for (const row of (data ?? []) as Array<{ id: string; meta: unknown }>) {
    const meta = row.meta as Record<string, unknown> | null;
    if (meta?.studio_state !== "generating") continue;
    await client
      .from("content_items")
      .update({ meta: mergeMeta(meta, { studio_state: "failed" }) })
      .eq("id", row.id);
  }
}

/* ───────────────────────── style ───────────────────────── */

/**
 * The brand's look (Brand DNA → Look & voice) plus the server's Brand DNA.
 * Never throws: a look that can't be loaded means Brand DNA facts only, not a
 * failed job.
 */
async function loadJobLook(workspaceId: string): Promise<LoadedLook | null> {
  try {
    return await loadBrandLook(workspaceId);
  } catch (error) {
    console.error("[studio] look load failed, using Brand DNA only", error);
    return null;
  }
}

/* ───────────────────────── carousel look ───────────────────────── */

function siteLabel(website: string | null | undefined): string | undefined {
  if (!website) return undefined;
  try {
    const host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname;
    return host.replace(/^www\./, "").slice(0, 60) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * How this carousel looks. A revision keeps the look its draft had; a new
 * carousel keeps the brand's layout and takes a colourway and motif the last
 * carousel didn't use, so the profile is consistent without repeating itself.
 */
function carouselSpec(args: {
  job: JobRow;
  input: CreateJobInput;
  ctx: StudioContext;
  dna: Record<string, unknown> | null;
  parent: JobRow | null;
  structure: string;
  ratio: AspectRatio;
}): CarouselSpecOutput {
  const { job, input, ctx, dna, parent } = args;
  const brand = ctx.brandName.slice(0, 60);
  const site = siteLabel(ctx.website);
  const kept = parent?.output?.carousel;
  const keptDesign = safeDesign(kept?.design);
  const keptTheme = safeTheme(kept?.theme);
  if (input.refine && keptDesign && keptTheme) {
    return { ...kept, design: keptDesign, theme: keptTheme, brand, site, ratio: args.ratio };
  }
  const palette = ctx.style
    ? ctx.style.visual.palette
    : paletteFromDnaColors((dna?.colors as never) ?? null);
  const dnaFonts = Array.isArray(dna?.fonts) ? (dna.fonts as string[]) : [];
  const fonts = ctx.style?.visual.typography ?? {
    heading: dnaFonts[0],
    body: dnaFonts[1] ?? dnaFonts[0],
  };
  const picked = pickCarouselDesign({
    profileKey: `${job.workspace_id}:brand`,
    seed: input.idempotencyKey,
    previous: ctx.recent.filter((r) => r.type === "carousel" && r.design).map((r) => r.design),
    palette,
  });
  const design: CarouselDesign = input.controls.seamless ? { ...picked, flow: "seamless" } : picked;
  return {
    structure: args.structure,
    design,
    theme: carouselTheme({ palette, fonts, colorway: design.colorway }),
    brand,
    site,
    ratio: args.ratio,
  };
}

/**
 * How this Story looks: the brand's carousel look (one profile, one hand),
 * with a colourway and motif the last Story didn't use. A revision keeps it.
 */
function storyLook(args: {
  job: JobRow;
  input: CreateJobInput;
  ctx: StudioContext;
  dna: Record<string, unknown> | null;
  parent: JobRow | null;
}): CarouselSpecOutput {
  const kept = args.parent?.output?.story?.spec;
  const keptDesign = safeDesign(kept?.design);
  const keptTheme = safeTheme(kept?.theme);
  const brand = args.ctx.brandName.slice(0, 60);
  const site = siteLabel(args.ctx.website);
  if (args.input.refine && kept && keptDesign && keptTheme) {
    return { ...kept, design: keptDesign, theme: keptTheme, brand, site, ratio: "9:16" };
  }
  const palette = args.ctx.style
    ? args.ctx.style.visual.palette
    : paletteFromDnaColors((args.dna?.colors as never) ?? null);
  const dnaFonts = Array.isArray(args.dna?.fonts) ? (args.dna.fonts as string[]) : [];
  const fonts = args.ctx.style?.visual.typography ?? {
    heading: dnaFonts[0],
    body: dnaFonts[1] ?? dnaFonts[0],
  };
  const design = pickCarouselDesign({
    profileKey: `${args.job.workspace_id}:brand`,
    seed: args.input.idempotencyKey,
    previous: args.ctx.recent.filter((r) => r.type === "story" && r.design).map((r) => r.design),
    palette,
  });
  return {
    design,
    theme: carouselTheme({ palette, fonts, colorway: design.colorway }),
    brand,
    site,
    ratio: "9:16",
  };
}

/** A repurposed source piece, read through the job's own client and workspace. */
async function loadSource(
  client: Db,
  workspaceId: string,
  id: string | undefined,
): Promise<{ title: string; body: string; kind: string; imagePath: string | null } | null> {
  if (!id) return null;
  const { data } = await client
    .from("content_items")
    .select("id, kind, title, body, meta")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const row = data as {
    kind: string;
    title: string | null;
    body: string | null;
    meta: unknown;
  } | null;
  if (!row)
    throw new StudioJobError(404, "The piece you're turning into a Story no longer exists.");
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const first =
    Array.isArray(meta.asset_storage_paths) && typeof meta.asset_storage_paths[0] === "string"
      ? meta.asset_storage_paths[0]
      : meta.asset_storage_path;
  const imagePath =
    meta.media_type !== "video" && isWorkspaceStoragePath(first, workspaceId)
      ? (first as string)
      : null;
  const slides = Array.isArray(meta.slides)
    ? (meta.slides as Array<Record<string, unknown>>)
        .map((s) => [s.heading, s.body].filter((x) => typeof x === "string").join(": "))
        .join("\n")
    : "";
  return {
    title: (row.title ?? "").slice(0, 200),
    body: [slides, row.body ?? ""].filter(Boolean).join("\n\n").slice(0, 4000),
    kind: row.kind,
    imagePath,
  };
}

/* ───────────────────────── media ───────────────────────── */

function brandLite(brand: CreateJobInput["brand"]): BrandDnaLite | null {
  return (brand ?? null) as BrandDnaLite | null;
}

function imagePrompt(args: {
  body: string;
  title: string;
  brand: BrandDnaLite | null;
  ctx: StudioContext;
  platform: PlatformId | null;
  ratio: AspectRatio;
  seed: string;
  variationKey?: string;
  extra?: string;
  style?: ImageStyleInput | null;
}): string {
  // The shared builder knows three canvases; 4:5 composes like square with a
  // taller safe area.
  const size =
    args.ratio === "16:9" ? "1792x1024" : args.ratio === "9:16" ? "1024x1792" : "1024x1024";
  const built = buildImagePromptDetailed({
    postBody: args.body,
    postTitle: args.title,
    brand: args.brand,
    workspaceName: args.ctx.brandName,
    platform: args.platform,
    size,
    seedKey: args.seed,
    variationKey: args.variationKey,
    style: args.style,
  }).prompt;
  return [
    built,
    args.ratio === "4:5"
      ? "Portrait 4:5 composition: keep the subject centered with generous top and bottom margins."
      : "",
    args.extra ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function videoPrompt(
  concept: string,
  ctx: StudioContext,
  ratio: AspectRatio,
  seconds: number,
): string {
  return [
    `Create a ${seconds}-second branded marketing video for ${ctx.brandName}. Aspect ratio ${ratio}.`,
    concept,
    `Shot plan: 0–2s, a visual hook immediately shows the tangible customer problem or desired result; 2–${Math.max(3, seconds - 2)}s, one clear product/service demonstration with a purposeful camera move; final 2s, a calm branded payoff with room for the platform caption. Each shot must depict the same product, setting and visual identity. Use motivated cuts only, natural motion and believable materials.`,
    "Avoid generic AI video tells: morphing products, warped hands, drifting logos, incoherent cuts, impossible camera movement, simulated social UI, or stock footage aesthetics.",
    "Keep on-screen text to at most one short verified phrase; if it cannot be spelled perfectly, use no text. No gibberish, watermarks, invented claims, or other brands' logos.",
    ctx.style ? videoStyleBlock(ctx.style) : "",
    ctx.brandText ? `Brand context:\n${(ctx.visualBrandText ?? ctx.brandText).slice(0, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function startMedia(args: {
  job: JobRow;
  input: CreateJobInput;
  ctx: StudioContext;
  output: StudioJobOutput;
  platforms: PlatformId[];
  referenceUrl?: string | null;
  style?: LoadedLook | null;
}): Promise<ProviderTask[]> {
  const { job, input, ctx, output, platforms } = args;
  const ratio = mediaRatio(job.type, input, platforms);
  const seed = job.group_id;
  const variationKey = `${job.attempt}:${job.idempotency_key}`;
  // The server's own Brand DNA; the browser copy is only a fallback for a
  // workspace whose DNA hasn't been saved yet.
  const serverDna = args.style?.dna && Object.keys(args.style.dna).length ? args.style.dna : null;
  const brand = brandLite((serverDna ?? input.brand) as CreateJobInput["brand"]);
  const styled = brand;
  const refineNote =
    input.refine && ["media", "all"].includes(input.refine.target)
      ? `Revision request: ${input.refine.instruction}`
      : undefined;
  const visualAvoidance = input.refine
    ? undefined
    : ctx.recent
        .filter((item) => item.type === job.type && item.excerpt)
        .slice(0, 4)
        .map((item) => `- ${item.excerpt}`)
        .join("\n");
  const noveltyNote = visualAvoidance
    ? `Recent visual concepts to avoid repeating; preserve the brand identity while changing the scene and focal idea:\n${visualAvoidance}`
    : undefined;

  if (job.type === "video" || (job.type === "story" && input.controls.storyMode === "video")) {
    const seconds = [4, 6, 8].includes(input.controls.durationSec ?? 0)
      ? input.controls.durationSec!
      : 8;
    // The shot plan written in the brief stage drives the render; the user's
    // own brief is the fallback if that stage produced nothing.
    const concept = output.concept?.trim() || input.intent.brief;
    const full = videoPrompt(
      [concept, refineNote, noveltyNote].filter(Boolean).join("\n\n"),
      ctx,
      ratio,
      seconds,
    );
    const started = await startStudioVideo({
      prompt: full,
      aspectRatio: ratio,
      durationSec: seconds,
      resolution: input.controls.videoResolution ?? "720P",
      audio: input.controls.audio ?? true,
      imageUrls: [],
    });
    return [
      {
        slot: "main",
        kind: "video",
        ratio,
        prompt: full,
        startedAt: Date.now(),
        state: "pending",
        fallbacks: [],
        ...started,
      },
    ];
  }

  // A connected carousel asks for one wide background picture with no words.
  // The slides are drawn over it by code once it is ready (pollStudioJob), so
  // every slide edge still meets.
  if (job.type === "carousel" && output.slides?.length && isSeamless(output.carousel?.design)) {
    const prompt = carouselBackdropPrompt({
      slides: output.slides,
      title: output.title,
      spec: output.carousel,
      brandName: ctx.brandName,
      brandContext: ctx.visualBrandText ?? ctx.brandText,
      style: ctx.style ? imageStyleInput(ctx.style) : null,
      revision: refineNote,
      novelty: noveltyNote,
    });
    const started = await startImageTask({
      prompt,
      size: IMAGE_SIZE_BY_RATIO[BACKDROP_RATIO] as ImageSize,
      referenceAssets: [],
    });
    return [
      {
        slot: BACKDROP_SLOT,
        kind: "image" as const,
        ratio: BACKDROP_RATIO,
        prompt,
        referenceAssets: [],
        startedAt: Date.now(),
        state: "pending" as const,
        ...started,
      },
    ];
  }

  const size = IMAGE_SIZE_BY_RATIO[ratio];
  if (!size) throw new StudioJobError(400, `${RATIOS[ratio].label} isn't available for images.`);
  const referenceAssets = args.referenceUrl ? [args.referenceUrl] : [];
  const seriesReferences = referenceAssets;
  if (job.type === "carousel" && output.slides?.length) {
    return Promise.all(
      output.slides.map(async (slide, index) => {
        const prompt = carouselSlidePrompt({
          slide,
          index,
          slides: output.slides!,
          spec: output.carousel,
          brandName: ctx.brandName,
          brandContext: ctx.visualBrandText ?? ctx.brandText,
          ratio,
          style: ctx.style ? imageStyleInput(ctx.style) : null,
          revision: refineNote,
          novelty: noveltyNote,
        });
        const started = await startImageTask({
          prompt,
          size: size as ImageSize,
          referenceAssets: seriesReferences,
        });
        return {
          slot: `slide:${index}`,
          kind: "image" as const,
          ratio,
          prompt,
          referenceAssets: seriesReferences,
          startedAt: Date.now(),
          state: "pending" as const,
          ...started,
        };
      }),
    );
  }
  if (job.type === "story" && output.story?.mode === "frames") {
    return Promise.all(
      output.story.frames.map(async (frame, index) => {
        const prompt = storyFramePrompt({
          frame,
          index,
          frames: output.story!.frames,
          spec: output.story!.spec,
          brandName: ctx.brandName,
          brandContext: ctx.visualBrandText ?? ctx.brandText,
          style: ctx.style ? imageStyleInput(ctx.style) : null,
          revision: refineNote,
          novelty: noveltyNote,
        });
        const started = await startImageTask({
          prompt,
          size: size as ImageSize,
          referenceAssets: seriesReferences,
        });
        return {
          slot: `frame:${index}`,
          kind: "image" as const,
          ratio,
          prompt,
          referenceAssets: seriesReferences,
          startedAt: Date.now(),
          state: "pending" as const,
          ...started,
        };
      }),
    );
  }
  const concept = (output as StudioJobOutput & { concept?: string }).concept;
  const body =
    job.type === "ad"
      ? ((output as StudioJobOutput & { visualConcept?: string }).visualConcept ??
        output.ads?.[0]?.primaryText ??
        input.intent.brief)
      : (concept ?? output.variants?.[0]?.body ?? input.intent.brief);
  // A media refine edits the previous render; otherwise the style's own
  // reference posts (close/exact) steer the look through image-to-image.
  const prompt = imagePrompt({
    body,
    title: output.title ?? input.intent.brief.slice(0, 80),
    brand: styled,
    ctx,
    platform: platforms[0] ?? null,
    ratio,
    seed,
    variationKey,
    extra: [refineNote, noveltyNote].filter(Boolean).join("\n\n"),
    style: ctx.style ? imageStyleInput(ctx.style) : null,
  });
  const started = await startImageTask({
    prompt,
    size: size as ImageSize,
    referenceAssets,
  });
  // Same rule the prompt was built with: it told the model to leave this
  // corner clean because the real logo goes there.
  const look = ctx.style ? imageStyleInput(ctx.style) : null;
  const logoUrl = look?.useLogo === false ? null : styled?.logoUrl?.trim() || null;
  const builderSize = ratio === "16:9" ? "1792x1024" : ratio === "9:16" ? "1024x1792" : "1024x1024";
  return [
    {
      slot: "main",
      kind: "image",
      ratio,
      prompt,
      referenceAssets,
      ...(logoUrl
        ? { logo: { url: logoUrl, corner: look?.logoCorner ?? logoCorner(builderSize) } }
        : {}),
      startedAt: Date.now(),
      state: "pending",
      ...started,
    },
  ];
}

/* ───────────────────────── create ───────────────────────── */

export async function createStudioJob(args: {
  client: unknown;
  workspaceId: string;
  userId: string;
  input: CreateJobInput;
  /** Persist the billing hold before provider work can begin. */
  onCreated?: (job: StudioJob) => Promise<void>;
}): Promise<StudioJob> {
  const client = db(args.client);
  const { workspaceId, input } = args;

  const { data: existing } = await client
    .from("studio_jobs")
    .select(JOB_COLS)
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) return presentJob(existing as JobRow);

  let parent: JobRow | null = null;
  if (input.parentJobId) {
    parent = await getJobRow(client, workspaceId, input.parentJobId);
    if (!parent) throw new StudioJobError(404, "The draft you're revising no longer exists.");
    if (parent.type !== input.type)
      throw new StudioJobError(400, "A revision must keep the same format.");
    const { data: active } = await client
      .from("studio_jobs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("group_id", parent.group_id)
      .in("status", ["queued", "running"])
      .limit(1);
    if (active?.length)
      throw new StudioJobError(
        409,
        "This draft is still generating. Wait for it to finish or cancel it first.",
      );
  }

  const { brand: _brand, workspaceId: _ws, ...storedInput } = input;
  const insert = {
    workspace_id: workspaceId,
    created_by: args.userId,
    type: input.type,
    status: "running",
    stage: "context",
    title: parent?.title ?? input.intent.brief.slice(0, 120),
    input: storedInput,
    output: parent?.output ?? {},
    idempotency_key: input.idempotencyKey,
    parent_job_id: parent?.id ?? null,
    ...(parent ? { group_id: parent.group_id } : {}),
    content_item_ids: parent?.content_item_ids ?? [],
    asset_ids: parent?.asset_ids ?? [],
    attempt: (parent?.attempt ?? 0) + 1,
  };
  const { data: inserted, error } = await client
    .from("studio_jobs")
    .insert(insert)
    .select(JOB_COLS)
    .single();
  if (error || !inserted) {
    if (String(error?.message).toLowerCase().includes("duplicate")) {
      const { data: raced } = await client
        .from("studio_jobs")
        .select(JOB_COLS)
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", input.idempotencyKey)
        .single();
      if (raced) return presentJob(raced as JobRow);
    }
    if (String(error?.message).includes("studio_jobs")) {
      throw new StudioJobError(
        503,
        "Studio jobs aren't set up in this database yet. Apply the latest migration.",
      );
    }
    throw new Error(error?.message ?? "Couldn't start generation");
  }

  const job = inserted as JobRow;
  try {
    if (args.onCreated) await args.onCreated(await presentJob(job));
    await executeJob(client, job, input, parent);
  } catch (err) {
    const classified = classify(err);
    await patchJob(client, job.id, {
      status: "failed",
      error: classified,
      completed_at: new Date().toISOString(),
    });
    if (!parent)
      await markDraftsFailed(
        client,
        workspaceId,
        (await getJobRow(client, workspaceId, job.id))?.content_item_ids ?? [],
      );
  }
  const fresh = await getJobRow(client, workspaceId, job.id);
  return presentJob(fresh ?? job);
}

/**
 * Add current web sources to the context when the brief is the kind that ages
 * badly without them — trends, statistics, industry developments, competitor
 * comparisons. A caption, a hook or a visual idea never triggers this, and a
 * failed or unconfigured search simply leaves the context as it was.
 */
async function withLiveResearch(ctx: StudioContext, input: CreateJobInput): Promise<StudioContext> {
  const brief = [input.intent?.brief, input.intent?.goal].filter(Boolean).join(" ").trim();
  if (!brief) return ctx;
  try {
    const [{ briefNeedsResearch }, { webSearch }, { formatSourcesForPrompt }] = await Promise.all([
      import("@/lib/research/triggers"),
      import("@/server/research/web-search.server"),
      import("@/lib/research/sources"),
    ]);
    if (!briefNeedsResearch(brief)) return ctx;
    const sources = await webSearch(`${ctx.brandName} ${brief}`.trim().slice(0, 300), {
      limit: 5,
      route: "studio.research",
    });
    if (!sources.length) return ctx;
    return {
      ...ctx,
      liveResearch: {
        summary: formatSourcesForPrompt(sources, 4_000),
        sources: sources.map((source) => ({ title: source.title, url: source.url })),
      },
    };
  } catch (error) {
    console.error("[studio] live research failed, generating without sources", error);
    return ctx;
  }
}

async function executeJob(client: Db, job: JobRow, input: CreateJobInput, parent: JobRow | null) {
  const type = job.type;
  const format = STUDIO_FORMATS[type];
  const platforms = platformsFor(type, input.controls.platforms);
  const controls = { ...input.controls, platforms };

  const base = await loadStudioContext(client, job.workspace_id, input.brand ?? null);
  const style = await loadJobLook(job.workspace_id);
  // Research is per-brief, so it cannot live in the 60s workspace context
  // cache. Most briefs skip it entirely and cost nothing.
  const ctx = await withLiveResearch(
    { ...base, style: style?.look.customized ? style.look : null },
    input,
  );

  const mediaOnly = !!input.refine && input.refine.target === "media" && !!parent;
  const addPlatforms = !!input.refine && input.refine.target === "platforms" && !!parent;
  const previousAngle = parent?.output?.angle ?? null;
  const angle: Angle = pickAngle(
    input.idempotencyKey,
    ctx.recent.map((r) => r.angle),
    input.refine ? ANGLE_ID(previousAngle) : undefined,
    // A planned piece keeps to the angles that do what it is for.
    input.intent.aim ? AIM_ANGLES[input.intent.aim] : undefined,
  );
  // A new piece opens in a way the last few didn't; a revision keeps its opening.
  const hook = input.refine
    ? undefined
    : pickHookStyle(
        input.idempotencyKey,
        ctx.recent.map((r) => r.hookStyle),
        // The plan already chose how this piece opens.
        input.intent.hookStyle,
      );
  const carouselStructure =
    type === "carousel"
      ? pickCarouselStructure({
          seed: input.idempotencyKey,
          angleId: angle.id,
          template: input.intent.template,
          brief: input.intent.brief,
          recent: ctx.recent.filter((r) => r.type === "carousel").map((r) => r.structure),
          preferred: input.refine ? parent?.output?.carousel?.structure : undefined,
        })
      : undefined;

  const storyTheme: StoryTheme | undefined =
    type === "story"
      ? pickStoryTheme({
          seed: input.idempotencyKey,
          mix: input.controls.storyTheme ? [input.controls.storyTheme] : undefined,
          recent: ctx.recent.filter((r) => r.type === "story").map((r) => r.storyTheme),
          preferred: input.refine
            ? parent?.output?.story?.theme
            : input.intent.sourceContentId
              ? "repurpose"
              : input.controls.storyTheme,
        })
      : undefined;
  const source = await loadSource(client, job.workspace_id, input.intent.sourceContentId);

  let output: StudioJobOutput = { ...(parent?.output ?? {}) };
  // Visual-only revisions must use edits saved on the content rows.
  if (mediaOnly && (type === "carousel" || type === "story") && job.content_item_ids.length) {
    const { data: edited } = await client
      .from("content_items")
      .select("meta")
      .eq("workspace_id", job.workspace_id)
      .eq("id", job.content_item_ids[0])
      .maybeSingle();
    const meta = edited?.meta as Record<string, unknown> | null;
    if (type === "carousel" && Array.isArray(meta?.slides))
      output = { ...output, slides: normalizeSlides(meta.slides, meta.slides.length) };
    if (type === "story" && output.story?.mode === "frames" && meta) {
      const frames = framesFromMeta(meta);
      if (frames.length) output = { ...output, story: { ...output.story, frames } };
    }
  }
  const partial: { target: string; error: string }[] = [];
  const firstStage = format.stages[1]?.id ?? "writing";

  if (!mediaOnly) {
    await setStage(client, job.id, firstStage);
    // Surface the chosen angle right away so the composer can show the decision.
    await patchJob(client, job.id, { output: { ...output, angle: angle.label } });
    const built = buildTextPrompt(type, {
      ctx,
      intent: input.intent,
      controls,
      angle,
      hook,
      carouselStructure,
      storyTheme,
      source,
      refine: input.refine,
      current: parent?.output,
    });
    if (firstStage !== "writing" && format.stages.some((s) => s.id === "writing")) {
      await setStage(client, job.id, "writing");
    }
    let rejected: string | null = null;
    let usableVariants: NonNullable<StudioJobOutput["variants"]> = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      partial.length = 0;
      const parsed = (await runStructuredPrompt({
        route: built.route,
        system: built.system,
        user:
          attempt === 0
            ? built.user
            : `${built.user}\n\n## Required correction\nThe previous candidate was rejected: ${rejected ?? "it was incomplete or repeated recent work"} Meet the requested format and length exactly. Choose a different audience question, opening line, example, structure and visual concept from anything listed as already made. If current web research is supplied, cite its exact URL beside the relevant article claim. Keep the user's brief and verified brand facts.`,
        schema: built.schema as never,
        maxTokens: built.maxTokens,
        temperature: built.temperature,
        regenerate: true,
      })) as Record<string, unknown>;
      let candidate = await shapeOutput({
        client,
        job,
        type,
        parsed,
        platforms,
        ctx,
        input,
        angle,
        hook,
        partial,
        storyTheme,
        sourceContentId: source ? input.intent.sourceContentId : undefined,
      });
      if (type === "social") {
        const byPlatform = new Map(
          [...usableVariants, ...(candidate.variants ?? [])]
            .filter((variant) => variant.body.trim().length >= 20)
            .map((variant) => [variant.platform, variant] as const),
        );
        usableVariants = [...byPlatform.values()];
      }
      // Give the model a second chance first; then keep the requested platform
      // set complete even if it repeats an omission or uses an unknown id.
      if (type === "social" && (attempt === 1 || input.refine)) {
        candidate = {
          ...candidate,
          variants: completeVariants(platforms, usableVariants, input.intent.brief),
        };
      }
      const similar = input.refine ? null : findSimilarRecent(type, candidate, ctx.recent);
      // Same opening as an earlier piece: worth one more try, never a failure.
      const repeatedOpening =
        input.refine || attempt === 1 ? null : findRepeatedOpening(candidate, ctx.recent);
      const qualityIssue = input.refine
        ? null
        : studioOutputQualityIssue(type, candidate, controls, platforms.length);
      const uncitedResearch =
        type === "article" &&
        !!ctx.liveResearch?.sources.length &&
        !hasResearchCitation(
          candidate.article?.markdown ?? "",
          ctx.liveResearch.sources.map((s) => s.url),
        );
      if (!similar && !uncitedResearch && !qualityIssue && !repeatedOpening) {
        output = candidate;
        break;
      }
      rejected = qualityIssue
        ? qualityIssue
        : uncitedResearch
          ? "It did not cite the research it was given."
          : similar
            ? `It was too close to “${similar.title}”.`
            : `It opened the same way as “${repeatedOpening!.opening}”.`;
      if (attempt === 1 && qualityIssue)
        throw new StudioJobError(502, `${qualityIssue} Try again with a clearer brief.`);
      if (attempt === 1 && uncitedResearch)
        throw new StudioJobError(
          502,
          "This article needs a citation to the current research used. Try again.",
        );
      if (attempt === 1 && similar)
        throw new StudioJobError(
          502,
          `This draft was too similar to “${similar.title}”. Try a more specific brief or a different angle.`,
        );
    }
  }

  // Copy must read human: no em dashes anywhere, whatever the model returned.
  output = humanizeOutput({
    ...output,
    angle: angle.label,
    partial: partial.length ? partial : undefined,
  });
  // Second pass: rewrite only the captions that still read like AI marketing
  // copy (cliché phrasing, robotic structure). Most ship untouched — this
  // only ever replaces a variant with a validated, fact-preserving rewrite,
  // never blocks the job if the model call fails.
  if (!mediaOnly && output.variants?.length) {
    output = {
      ...output,
      variants: await naturalizeVariants(output.variants, {
        brandName: ctx.brandName,
        brandText: ctx.brandText,
        styleText: ctx.style ? writingStyleBlock(ctx.style, "social") : undefined,
        protectedTerms: ctx.style ? styleProtectedTerms(ctx.style) : undefined,
      }),
    };
    // A caption that uses a word the team asked Mellox to avoid (ADR-0033)
    // carries a warning: a person sees it, and fully automatic mode holds it.
    const memories = await loadMemories(job.workspace_id);
    const broken = (output.variants ?? []).flatMap((v) => checkMemoryConformance(v.body, memories));
    if (broken.length) {
      output = {
        ...output,
        warnings: [...new Set([...(output.warnings ?? []), ...broken.map((i) => i.message)])],
      };
    }
  }
  if (addPlatforms && parent?.output) {
    output = mergeAddedPlatforms(parent.output, output, platforms);
  }
  const title = (output.title || input.intent.brief).slice(0, 120);
  if (type === "carousel" && output.slides?.length) {
    output = {
      ...output,
      carousel: carouselSpec({
        job,
        input,
        ctx,
        dna: base.brand,
        parent,
        structure: carouselStructure?.id ?? "list",
        ratio: mediaRatio(type, input, platforms),
      }),
    };
  }

  if (type === "story" && output.story?.mode === "frames" && output.story.frames.length) {
    output = {
      ...output,
      story: { ...output.story, spec: storyLook({ job, input, ctx, dna: base.brand, parent }) },
    };
  }

  // Drafts before rendering so the asset can link to them.
  const polishStage: StageId = format.stages.some((s) => s.id === "polish") ? "polish" : "save";
  if (!mediaOnly) {
    if (polishStage === "polish") await setStage(client, job.id, "polish");
    const rows = draftRows(type, output, platforms);
    const ids = await writeDrafts(
      client,
      job,
      rows,
      {
        angle: angle.id,
        ...(hook ? { hook_style: hook.id } : {}),
        intent_goal: input.intent.goal ?? null,
        idea_id: input.intent.ideaId ?? null,
        template: input.intent.template ?? null,
        // The job's headline, so every surface titles the piece consistently.
        job_title: title,
        brand_version: brandVersion(input.brand),
        ...(needsMedia(type, input) ? { aspect_ratio: mediaRatio(type, input, platforms) } : {}),
      },
      addPlatforms,
    );
    job.content_item_ids = ids;
    if (addPlatforms) {
      const asset = parent?.output?.media?.find(
        (item) => item.status === "ready" && item.assetId && item.storagePath,
      );
      if (asset?.assetId && asset.storagePath) {
        await linkAssetToContent(job.workspace_id, ids, {
          id: asset.assetId,
          path: asset.storagePath,
          assetType: asset.kind,
        });
      }
    }
    await patchJob(client, job.id, { content_item_ids: ids, output, title });
    invalidateStudioContext(job.workspace_id);
  }

  // A connected carousel is drawn by code over one generated background:
  // pictures generated slide by slide can never meet at the slide edges.
  // Text the slide fonts can't draw is made the ordinary way instead.
  if (
    type === "carousel" &&
    output.slides?.length &&
    output.carousel &&
    isSeamless(output.carousel.design) &&
    !carouselRenderable({ slides: output.slides, brand: output.carousel.brand })
  ) {
    const { flow: _flow, ...plain } = output.carousel.design;
    output = {
      ...output,
      carousel: { ...output.carousel, design: plain },
      warnings: [
        ...new Set([
          ...(output.warnings ?? []),
          "Connected slides couldn't be drawn for this text, so each slide was made on its own.",
        ]),
      ],
    };
  }
  const connected = type === "carousel" && isSeamless(output.carousel?.design);

  if (needsMedia(type, input) && !addPlatforms) {
    await setStage(client, job.id, "render");
    let referenceUrl: string | null = null;
    const currentMedia = parent?.output?.media?.find((m) => m.status === "ready");
    if (mediaOnly && currentMedia?.storagePath && currentMedia.kind === "image") {
      referenceUrl = await signAssetPath(currentMedia.storagePath);
    }
    try {
      const tasks = await startMedia({ job, input, ctx, output, platforms, referenceUrl, style });
      const media: MediaOutput[] = tasks.map((t) => ({
        slot: t.slot,
        kind: t.kind,
        ratio: t.ratio,
        status: "pending",
      }));
      const keepOldMedia = (parent?.output?.media ?? []).filter(
        (m) => !tasks.some((t) => t.slot === m.slot),
      );
      await patchJob(client, job.id, {
        provider_tasks: tasks,
        output: { ...output, media: [...keepOldMedia, ...media] },
        title,
      });
      return; // advanced by polling
    } catch (err) {
      const classified = classify(err);
      if (connected && output.slides && output.carousel) {
        // No background picture this time: the slides are still drawn, plain.
        console.warn("[studio] connected carousel drawn without a picture", classified.message);
        await storeCarouselSlides({
          workspaceId: job.workspace_id,
          contentItemIds: job.content_item_ids,
          slides: output.slides,
          spec: output.carousel,
        });
      } else if (format.media === "optional-image") {
        // The copy is still good — succeed with a visible partial failure.
        output = {
          ...output,
          partial: [...(output.partial ?? []), { target: "media", error: classified.message }],
        };
      } else {
        throw err;
      }
    }
  }

  await patchJob(client, job.id, {
    status: "succeeded",
    stage: "polish",
    output,
    title,
    completed_at: new Date().toISOString(),
  });
  if (!mediaOnly) {
    await revealDrafts(client, job.workspace_id, job.content_item_ids, !!input.approve);
    await retireSourceDraft(client, job.workspace_id, input.fromContentId, job.id);
  }
}

function ANGLE_ID(label: string | null): string | undefined {
  if (!label) return undefined;
  const lower = label.toLowerCase();
  const map: Record<string, string> = {
    "contrarian take": "contrarian",
    "practical how-to": "how-to",
    "proof and results": "proof",
    "customer story": "story",
    "myth vs reality": "myth",
    "data point": "data",
    "objection handling": "objection",
    "behind the scenes": "behind-scenes",
    checklist: "checklist",
    "before and after": "comparison",
  };
  return map[lower];
}

async function shapeOutput(args: {
  client: Db;
  job: JobRow;
  type: StudioType;
  parsed: Record<string, unknown>;
  platforms: PlatformId[];
  ctx: StudioContext;
  input: CreateJobInput;
  angle: Angle;
  hook?: ReturnType<typeof pickHookStyle>;
  partial: { target: string; error: string }[];
  storyTheme?: StoryTheme;
  sourceContentId?: string;
}): Promise<StudioJobOutput> {
  const { client, job, type, parsed, platforms, ctx, input, angle, partial } = args;
  const title = String(parsed.title ?? "").trim() || input.intent.brief.slice(0, 80);

  switch (type) {
    case "social": {
      const { variants } = finalizeVariants(platforms, parsed as never);
      return { title, variants };
    }
    case "carousel": {
      const caption = String(parsed.caption ?? "");
      const hashtags = (parsed.hashtags as string[]) ?? [];
      return {
        title,
        slides: normalizeSlides(parsed.slides, input.controls.slideCount ?? 6),
        variants: platforms.map((p) => finalizeVariant(p, { title, body: caption, hashtags })),
      };
    }
    case "article": {
      const markdown = String(parsed.markdown ?? "").replace(/^#\s+.+\n+/, "");
      return {
        title,
        article: {
          title,
          dek: String(parsed.dek ?? ""),
          metaDescription: String(parsed.metaDescription ?? ""),
          takeaways: (parsed.takeaways as string[]) ?? [],
          markdown,
          wordCount: countWords(markdown),
          faq: ((parsed.faq as { question: string; answer: string }[]) ?? []).filter(
            (f) => f.question && f.answer,
          ),
          slug: String(parsed.slug ?? ""),
          category: String(parsed.category ?? ""),
          tags: (parsed.tags as string[]) ?? [],
        },
      };
    }
    case "script": {
      const p = platforms[0] ?? "instagram";
      const caption = finalizeVariant(p, {
        body: String(parsed.caption ?? ""),
        hashtags: (parsed.hashtags as string[]) ?? [],
      });
      return {
        title,
        script: {
          title,
          hook: String(parsed.hook ?? ""),
          beats: parsed.beats as NonNullable<StudioJobOutput["script"]>["beats"],
          cta: String(parsed.cta ?? ""),
          caption: caption.body,
          durationSec: input.controls.durationSec ?? 30,
        },
      };
    }
    case "story": {
      const theme = args.storyTheme?.id ?? "tip";
      const mentions = cleanMentions(input.controls.mentions ?? []);
      if (input.controls.storyMode === "video") {
        return {
          title,
          story: {
            mode: "video",
            theme,
            frames: [],
            mentions,
            ...(args.sourceContentId ? { sourceContentId: args.sourceContentId } : {}),
          },
          ...({
            concept: String(parsed.concept ?? ""),
            altText: String(parsed.altText ?? ""),
          } as object),
        };
      }
      return {
        title,
        story: {
          mode: "frames",
          theme,
          frames: normalizeFrames(parsed.frames, {
            theme: args.storyTheme,
            count: input.controls.frameCount ?? 3,
          }),
          mentions,
          ...(args.sourceContentId ? { sourceContentId: args.sourceContentId } : {}),
        },
      };
    }
    case "ad":
      return {
        title,
        ads: parsed.variants as StudioJobOutput["ads"],
        ...({ visualConcept: String(parsed.visualConcept ?? "") } as object),
      };
    case "image":
    case "video": {
      const concept = String(parsed.concept ?? "");
      const visual = [concept, parsed.onImageText ? `Text in visual: ${parsed.onImageText}` : ""]
        .filter(Boolean)
        .join("\n");
      await setStage(client, job.id, "captions");
      const captionPrompt = buildCaptionPrompt({
        ctx,
        intent: input.intent,
        controls: { ...input.controls, platforms },
        angle,
        hook: args.hook,
        visual,
      });
      let variants: StudioJobOutput["variants"] = [];
      try {
        const captions = await runStructuredPrompt({
          route: captionPrompt.route,
          system: captionPrompt.system,
          user: captionPrompt.user,
          schema: captionPrompt.schema,
          maxTokens: captionPrompt.maxTokens,
          temperature: captionPrompt.temperature,
          regenerate: true,
        });
        const result = finalizeVariants(platforms, captions);
        variants = result.variants;
      } catch (err) {
        partial.push({ target: "captions", error: classify(err).message });
      }
      return {
        title,
        variants: completeVariants(platforms, variants, input.intent.brief),
        ...({ concept: visual, altText: String(parsed.altText ?? "") } as object),
      };
    }
  }
}

/* ───────────────────────── media providers ───────────────────────── */

/** Studio video renders use the `premium` catalog model on the configured provider. */
const STUDIO_VIDEO_MODEL = "premium" as const;

async function startStudioVideo(opts: {
  prompt: string;
  aspectRatio: string;
  durationSec: number;
  resolution: "480P" | "720P" | "1080P";
  audio: boolean;
  imageUrls: string[];
}): Promise<{ taskId: string; model: string; provider: string; route: string }> {
  // The most expensive call in the product: quota + spend ceiling apply.
  await enforceBudget("video");
  const submitted = await routedVideoProvider.submit({
    model: activeModel(STUDIO_VIDEO_MODEL),
    prompt: opts.prompt,
    durationSec: opts.durationSec,
    aspectRatio: opts.aspectRatio as UgcAspectRatio,
    resolution: opts.resolution.toLowerCase() as UgcResolution,
    audio: opts.audio,
    imageUrls: opts.imageUrls,
  });
  if (!submitted.ok) throw new StudioJobError(submitted.retryable ? 503 : 502, submitted.message);
  return {
    taskId: submitted.taskId,
    model: submitted.providerModel,
    provider: submitted.provider,
    route: "video",
  };
}

type MediaCheck =
  | { state: "pending" }
  | { state: "failed"; message: string }
  | { state: "success"; url?: string; dataUrl?: string; costUsd: number | null };

/** Models return 3:4 for requested 4:5; crop only the finished model image. */
async function fitPortraitImage(dataUrl: string, ratio: AspectRatio): Promise<string> {
  if (ratio !== "4:5") return dataUrl;
  const match = /^data:image\/(?:png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl);
  if (!match) return dataUrl;
  const input = Buffer.from(match[1], "base64");
  const dimensions = await sharp(input).metadata();
  if (
    !dimensions.width ||
    !dimensions.height ||
    Math.abs(dimensions.width / dimensions.height - 0.8) < 0.005
  )
    return dataUrl;
  const bytes = await sharp(input)
    .resize(1024, 1280, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/** One status read of a render; the finished file comes back as a URL or its bytes. */
async function checkMediaTask(task: ProviderTask): Promise<MediaCheck> {
  if (task.kind === "image") {
    if (!isImageTask(task.taskId)) {
      // A render started on the retired KIE image path before this release.
      return {
        state: "failed",
        message: "This render was started on a retired image service. Try again.",
      };
    }
    const image = await checkImageTask(task.taskId);
    if (image.state !== "success") return image;
    return { state: "success", dataUrl: image.dataUrl, costUsd: image.costUsd };
  }
  const provider = task.provider ?? "kie";
  const check = await routedVideoProvider.check(task.taskId, provider);
  if (check.state === "pending") return { state: "pending" };
  if (check.state === "failed") return { state: "failed", message: check.message };
  const downloaded = await routedVideoProvider.download?.(check.videoUrl, provider);
  return downloaded
    ? { state: "success", dataUrl: downloaded.dataUrl, costUsd: check.costUsd }
    : { state: "success", url: check.videoUrl, costUsd: check.costUsd };
}

/* ───────────────────────── poll / advance ───────────────────────── */

export async function advanceStudioJob(client: unknown, row: JobRow): Promise<JobRow> {
  const c = db(client);
  if (row.status !== "running") return row;
  const pending = (row.provider_tasks ?? []).filter((t) => t.state === "pending");
  if (!pending.length) return row;

  const now = Date.now();
  const { data: leased } = await c
    .from("studio_jobs")
    .update({ lease_until: new Date(now + LEASE_MS).toISOString() })
    .eq("id", row.id)
    .eq("status", "running")
    .or(`lease_until.is.null,lease_until.lt.${new Date(now).toISOString()}`)
    .select("id");
  if (!leased?.length) return row; // another poll is advancing it

  const tasks = [...row.provider_tasks];
  const media = [...(row.output?.media ?? [])];
  const assetIds = [...(row.asset_ids ?? [])];
  const warnings = [...(row.output?.warnings ?? [])];
  let stage: StageId = row.stage;

  for (const task of tasks) {
    if (task.state !== "pending") continue;
    const slot = media.findIndex((m) => m.slot === task.slot);
    const setMedia = (patch: Partial<MediaOutput>) => {
      if (slot >= 0) media[slot] = { ...media[slot], ...patch };
    };
    try {
      if (now - task.startedAt > RENDER_TIMEOUT_MS) {
        task.state = "failed";
        setMedia({ status: "failed", error: "The render took too long. Try again." });
        continue;
      }
      const check = await checkMediaTask(task);
      if (check.state === "pending") continue;
      if (check.state === "failed") {
        // Image attempts are metered where they ran; a failed video costs nothing.
        const next = task.kind === "image" ? task.fallbacks[0] : undefined;
        if (next) {
          const size = IMAGE_SIZE_BY_RATIO[task.ratio] as ImageSize;
          const restarted = await startImageTask({
            prompt: task.prompt,
            size,
            model: next,
            referenceAssets: task.referenceAssets,
          });
          Object.assign(task, {
            taskId: restarted.taskId,
            model: next,
            fallbacks: task.fallbacks.slice(1),
            startedAt: Date.now(),
          });
          continue;
        }
        task.state = "failed";
        setMedia({ status: "failed", error: check.message });
        continue;
      }
      stage = "save";
      await setStage(c, row.id, "save");
      const finalImage =
        check.dataUrl && task.kind === "image"
          ? await fitPortraitImage(check.dataUrl, task.ratio)
          : check.dataUrl;
      const imageReview =
        task.kind === "image" && finalImage
          ? await reviewGeneratedImage(
              finalImage,
              [row.title, row.output?.concept, task.prompt.slice(-1900), task.prompt.slice(0, 350)]
                .filter(Boolean)
                .join("\n"),
            )
          : null;
      if (imageReview?.status === "warn" && (task.reviewAttempts ?? 0) < 1) {
        const repairPrompt = [
          task.prompt,
          "The previous render was rejected by visual quality review. Correct these specific visible defects and create a fresh, polished composition:",
          ...imageReview.issues.map((issue) => `- ${issue}`),
          "Preserve the supplied brand identity and exact verified copy. Do not recreate the defect.",
        ].join("\n");
        const restarted = await startImageTask({
          prompt: repairPrompt,
          size: IMAGE_SIZE_BY_RATIO[task.ratio] as ImageSize,
          referenceAssets: task.referenceAssets,
        });
        Object.assign(task, {
          taskId: restarted.taskId,
          model: restarted.model,
          fallbacks: restarted.fallbacks,
          prompt: repairPrompt,
          reviewAttempts: 1,
          startedAt: Date.now(),
        });
        continue;
      }
      if (imageReview?.status === "warn")
        warnings.push(...imageReview.issues.map((issue) => `Visual review: ${issue}`));
      if (task.kind === "image" && !imageReview)
        warnings.push("Visual review was unavailable. Check this artwork before publishing.");
      const savedImage =
        finalImage && task.kind === "image" && task.logo
          ? await overlayBrandLogo(finalImage, task.logo.url, task.logo.corner)
          : finalImage;
      const persisted = await persistAsset({
        workspaceId: row.workspace_id,
        idempotencyKey: `studio:${row.id}:${task.slot}:${task.taskId}`,
        ...(savedImage ? { dataUrl: savedImage } : { sourceUrl: check.url }),
        contentItemIds: row.content_item_ids,
        assetType: task.kind,
        filename: `mellox-${row.type}-${task.ratio.replace(":", "x")}-${row.id.slice(0, 8)}`,
        platform: null,
        model: task.model,
        attempt: row.attempt,
        seed: row.group_id,
        promptVersion: "studio-2",
        metadata: {
          source: "studio",
          job_id: row.id,
          aspect_ratio: task.ratio,
          studio_type: row.type,
          ...(imageReview ? { image_review: imageReview } : {}),
        },
      });
      if (task.kind === "video") {
        recordUsage({
          provider: task.provider === "kie" ? "kie" : "openrouter",
          model: task.model,
          kind: "video",
          units: 1,
          estCostUsd: check.costUsd ?? undefined,
          latencyMs: Date.now() - task.startedAt,
        });
      }
      if (!persisted.ok) {
        task.state = "failed";
        setMedia({ status: "failed", error: persisted.message });
        continue;
      }
      task.state = "done";
      assetIds.push(persisted.asset.id);
      setMedia({
        status: "ready",
        assetId: persisted.asset.id,
        storagePath: persisted.asset.storage_path ?? undefined,
        error: undefined,
      });
    } catch (err) {
      task.state = "failed";
      setMedia({ status: "failed", error: classify(err).message });
    }
  }

  const done = tasks.every((t) => t.state !== "pending");
  const patch: Record<string, unknown> = {
    provider_tasks: tasks,
    output: { ...row.output, media, warnings: [...new Set(warnings)] },
    asset_ids: [...new Set(assetIds)],
    lease_until: null,
    stage,
  };

  if (done) {
    const failed = media.filter((m) => m.status === "failed");
    const format = STUDIO_FORMATS[row.type];
    const mediaRequired =
      format.media === "image" ||
      format.media === "video" ||
      row.type === "carousel" ||
      row.type === "story";
    const isRefine = !!row.parent_job_id;
    // A connected carousel is drawn by code; its background picture is a
    // bonus, so a failed one never fails the carousel.
    const connected = row.type === "carousel" && isSeamless(row.output?.carousel?.design);
    const incompleteSeries =
      !connected && (row.type === "carousel" || row.type === "story") && failed.length > 0;
    if (
      failed.length &&
      !connected &&
      mediaRequired &&
      (incompleteSeries || !media.some((m) => m.status === "ready"))
    ) {
      Object.assign(patch, {
        status: "failed",
        error: {
          category: "provider",
          message: userSafeMessage(failed[0].error, "The render failed. Please try again."),
          retryable: true,
        },
        completed_at: new Date().toISOString(),
      });
      if (!isRefine) await markDraftsFailed(c, row.workspace_id, row.content_item_ids);
    } else {
      Object.assign(patch, {
        status: "succeeded",
        completed_at: new Date().toISOString(),
        output: {
          ...row.output,
          media,
          warnings: [...new Set(warnings)],
          partial: [
            ...(row.output?.partial ?? []),
            ...(connected ? [] : failed).map((m) => ({
              target: "media",
              error: m.error ?? "The visual failed to render.",
            })),
          ].filter(Boolean),
        },
      });
      let linked = true;
      if (connected && row.output?.slides && row.output.carousel) {
        const picture = media.find((m) => m.slot === BACKDROP_SLOT && m.status === "ready");
        const stored = await storeCarouselSlides({
          workspaceId: row.workspace_id,
          contentItemIds: row.content_item_ids,
          slides: row.output.slides,
          spec: row.output.carousel,
          coverPath: picture?.storagePath ?? null,
        });
        linked = !!stored;
      } else if (row.type === "carousel" && row.output?.slides && row.output.carousel) {
        linked = await linkGeneratedCarousel({
          workspaceId: row.workspace_id,
          contentItemIds: row.content_item_ids,
          slides: row.output.slides,
          spec: row.output.carousel,
          assets: row.output.slides.map((_, i) => {
            const m = media.find((entry) => entry.slot === `slide:${i}`);
            return { id: m?.assetId ?? "", path: m?.storagePath ?? "" };
          }),
        });
      }
      if (row.type === "story" && row.output?.story?.mode === "frames") {
        linked = await linkGeneratedStory({
          workspaceId: row.workspace_id,
          contentItemIds: row.content_item_ids,
          frames: row.output.story.frames,
          assets: row.output.story.frames.map((_, i) => {
            const m = media.find((entry) => entry.slot === `frame:${i}`);
            return { id: m?.assetId ?? "", path: m?.storagePath ?? "" };
          }),
        });
      }
      if (!linked) {
        Object.assign(patch, {
          status: "failed",
          error: {
            category: "provider",
            message: "The complete image series could not be saved. Try again.",
            retryable: true,
          },
        });
        if (!isRefine) await markDraftsFailed(c, row.workspace_id, row.content_item_ids);
      } else {
        await revealDrafts(c, row.workspace_id, row.content_item_ids, !!row.input?.approve);
        await retireSourceDraft(c, row.workspace_id, row.input?.fromContentId, row.id);
      }
    }
  }

  await patchJob(c, row.id, patch);
  return (await getJobRow(c, row.workspace_id, row.id)) ?? row;
}

/* ───────────────────────── cancel ───────────────────────── */

export async function cancelStudioJob(
  client: unknown,
  workspaceId: string,
  id: string,
): Promise<StudioJob> {
  const c = db(client);
  const row = await getJobRow(c, workspaceId, id);
  if (!row) throw new StudioJobError(404, "Job not found");
  if (row.status !== "running" && row.status !== "queued") return presentJob(row);

  const { data } = await c
    .from("studio_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      provider_tasks: (row.provider_tasks ?? []).map((t) => ({
        ...t,
        state: t.state === "pending" ? "failed" : t.state,
      })),
    })
    .eq("id", id)
    .in("status", ["running", "queued"])
    .select(JOB_COLS);
  const cancelled = (data?.[0] as JobRow | undefined) ?? row;

  // A brand-new creation leaves nothing behind; a revision keeps the drafts it
  // was revising (they were never changed by the unfinished render).
  if (!row.parent_job_id && row.content_item_ids.length) {
    const { data: rows } = await c
      .from("content_items")
      .select("id, status, meta")
      .in("id", row.content_item_ids);
    const drop = (
      (rows ?? []) as Array<{ id: string; status: string; meta: Record<string, unknown> | null }>
    )
      .filter((r) => r.status === "draft" && r.meta?.studio_state === "generating")
      .map((r) => r.id);
    if (drop.length) await c.from("content_items").delete().in("id", drop);
  }
  return presentJob(cancelled);
}
