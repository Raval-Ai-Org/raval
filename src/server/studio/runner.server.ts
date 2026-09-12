// runner.server.ts — executes Studio jobs.
//
//   create → context → text (LLM) → drafts → [provider render tasks] → succeeded
//
// Text runs inline in the create request (tens of seconds). Image/video renders
// are started at the provider and advanced by `advanceStudioJob` on each poll,
// so no request waits on a render and the job survives navigation. Every write
// goes through the caller's RLS client except asset storage (service role, in
// persist.server.ts).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runStructuredPrompt, AiOutputError, AiGatewayError } from "@/lib/ai";
import { BudgetExceededError } from "@/server/ai/budget";
import { UpstreamError } from "@/server/upstream";
import {
  checkTask,
  pickVideoUrl,
  recordTaskUsage,
  startImageTask,
  startVideoTask,
  type KieImageSize,
  type VideoAspectRatio,
} from "@/lib/kie-gateway.server";
import { persistAsset, signAssetPath } from "@/server/assets/persist.server";
import { buildImagePromptDetailed, type BrandDnaLite } from "@/lib/post-image";
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
  model: string;
  fallbacks: string[];
  ratio: AspectRatio;
  prompt: string;
  startedAt: number;
  state: "pending" | "done" | "failed";
};

type JobRow = StudioJob & { provider_tasks: ProviderTask[]; idempotency_key: string };

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
    return {
      category: status === 429 ? "rate_limit" : status === 503 ? "configuration" : "provider",
      message: error.message,
      retryable: status !== 400 && status !== 422 && status !== 503,
    };
  }
  if (error instanceof StudioJobError) {
    return { category: "request", message: error.message, retryable: false };
  }
  return {
    category: "unknown",
    message: error instanceof Error ? error.message : "Generation failed",
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
  const picked = allowed.length ? allowed : format.defaultPlatforms;
  return format.multiPlatform ? picked : picked.slice(0, 1);
}

function mediaRatio(type: StudioType, input: CreateJobInput, platforms: PlatformId[]): AspectRatio {
  const format = STUDIO_FORMATS[type];
  const requested = input.controls.ratio;
  if (requested && format.ratios.includes(requested)) return requested;
  if (type === "carousel") return "4:5";
  return recommendedRatio(platforms, type === "video" ? "video" : "image", format.ratios);
}

function needsMedia(type: StudioType, input: CreateJobInput): boolean {
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
        meta: { platform: v.platform, chars: v.chars },
      }));
    case "carousel":
      return (output.variants ?? []).map((v) => ({
        ...base,
        platform: v.platform,
        channel: channelForPlatform(v.platform),
        body: v.body,
        hashtags: v.hashtags,
        meta: { platform: v.platform, slides: output.slides ?? [] },
      }));
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

/** Surface a finished group in Needs Approval. */
async function revealDrafts(client: Db, workspaceId: string, ids: string[]) {
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
      .update({ meta, ...(row.status === "draft" ? { status: "pending" } : {}) })
      .eq("id", row.id);
    if (error) console.warn("[studio] reveal failed", row.id, error.message);
  }
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
  extra?: string;
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
    "Coherent, purposeful camera movement. A clear opening hook, one focused product or service moment, and a clean closing frame.",
    "Keep on-screen text minimal and legible; no gibberish, watermarks, or other brands' logos.",
    ctx.brandText ? `Brand context:\n${ctx.brandText.slice(0, 1200)}` : "",
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
}): Promise<ProviderTask[]> {
  const { job, input, ctx, output, platforms } = args;
  const ratio = mediaRatio(job.type, input, platforms);
  const seed = `${job.group_id}:${job.attempt}:${job.idempotency_key}`;
  const brand = brandLite(input.brand);
  const refineNote =
    input.refine && ["media", "all"].includes(input.refine.target)
      ? `Revision request: ${input.refine.instruction}`
      : undefined;

  if (job.type === "video") {
    const seconds = [4, 6, 8].includes(input.controls.durationSec ?? 0)
      ? input.controls.durationSec!
      : 6;
    // The shot plan written in the brief stage drives the render; the user's
    // own brief is the fallback if that stage produced nothing.
    const concept = output.concept?.trim() || input.intent.brief;
    const full = videoPrompt(
      [concept, refineNote].filter(Boolean).join("\n\n"),
      ctx,
      ratio,
      seconds,
    );
    const started = await startVideoTask({
      prompt: full,
      aspectRatio: ratio as VideoAspectRatio,
      duration: seconds,
      resolution: input.controls.videoResolution ?? "720P",
      audio: input.controls.audio ?? true,
    });
    return [
      {
        slot: "main",
        kind: "video",
        ratio,
        prompt: full,
        startedAt: Date.now(),
        state: "pending",
        ...started,
      },
    ];
  }

  const size = IMAGE_SIZE_BY_RATIO[ratio];
  if (!size) throw new StudioJobError(400, `${RATIOS[ratio].label} isn't available for images.`);
  const concept = (output as StudioJobOutput & { concept?: string }).concept;
  const body =
    job.type === "ad"
      ? ((output as StudioJobOutput & { visualConcept?: string }).visualConcept ??
        output.ads?.[0]?.primaryText ??
        input.intent.brief)
      : job.type === "carousel"
        ? [output.slides?.[0]?.heading, output.slides?.[0]?.visual].filter(Boolean).join("\n")
        : (concept ?? output.variants?.[0]?.body ?? input.intent.brief);
  const prompt = imagePrompt({
    body,
    title: output.title ?? input.intent.brief.slice(0, 80),
    brand,
    ctx,
    platform: platforms[0] ?? null,
    ratio,
    seed,
    extra: refineNote,
  });
  const started = await startImageTask({
    prompt,
    size: size as KieImageSize,
    referenceAssets: args.referenceUrl ? [args.referenceUrl] : [],
  });
  return [
    {
      slot: "main",
      kind: "image",
      ratio,
      prompt,
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

async function executeJob(client: Db, job: JobRow, input: CreateJobInput, parent: JobRow | null) {
  const type = job.type;
  const format = STUDIO_FORMATS[type];
  const platforms = platformsFor(type, input.controls.platforms);
  const controls = { ...input.controls, platforms };

  const ctx = await loadStudioContext(client, job.workspace_id, input.brand ?? null);

  const mediaOnly = !!input.refine && input.refine.target === "media" && !!parent;
  const previousAngle = parent?.output?.angle ?? null;
  const angle: Angle = pickAngle(
    input.idempotencyKey,
    ctx.recent.map((r) => r.angle),
    input.refine ? ANGLE_ID(previousAngle) : undefined,
  );

  let output: StudioJobOutput = { ...(parent?.output ?? {}) };
  const partial: { target: string; error: string }[] = [];
  const firstStage = format.stages[1]?.id ?? "writing";

  if (!mediaOnly) {
    await setStage(client, job.id, firstStage);
    const built = buildTextPrompt(type, {
      ctx,
      intent: input.intent,
      controls,
      angle,
      refine: input.refine,
      current: parent?.output,
    });
    if (firstStage !== "writing" && format.stages.some((s) => s.id === "writing")) {
      await setStage(client, job.id, "writing");
    }
    const parsed = (await runStructuredPrompt({
      route: built.route,
      system: built.system,
      user: built.user,
      schema: built.schema as never,
      maxTokens: built.maxTokens,
      temperature: built.temperature,
      regenerate: true,
    })) as Record<string, unknown>;
    output = await shapeOutput({
      client,
      job,
      type,
      parsed,
      platforms,
      ctx,
      input,
      angle,
      partial,
    });
  }

  output = { ...output, angle: angle.label, partial: partial.length ? partial : undefined };
  const title = (output.title || input.intent.brief).slice(0, 120);

  // Drafts before rendering so the asset can link to them.
  const polishStage: StageId = format.stages.some((s) => s.id === "polish") ? "polish" : "save";
  if (!mediaOnly) {
    if (polishStage === "polish") await setStage(client, job.id, "polish");
    const rows = draftRows(type, output, platforms);
    const ids = await writeDrafts(client, job, rows, {
      angle: angle.id,
      intent_goal: input.intent.goal ?? null,
      idea_id: input.intent.ideaId ?? null,
      brand_version: brandVersion(input.brand),
      ...(needsMedia(type, input) ? { aspect_ratio: mediaRatio(type, input, platforms) } : {}),
    });
    job.content_item_ids = ids;
    await patchJob(client, job.id, { content_item_ids: ids, output, title });
    invalidateStudioContext(job.workspace_id);
  }

  if (needsMedia(type, input)) {
    await setStage(client, job.id, "render");
    let referenceUrl: string | null = null;
    const currentMedia = parent?.output?.media?.find((m) => m.status === "ready");
    if (mediaOnly && currentMedia?.storagePath && currentMedia.kind === "image") {
      referenceUrl = await signAssetPath(currentMedia.storagePath);
    }
    try {
      const tasks = await startMedia({ job, input, ctx, output, platforms, referenceUrl });
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
      if (format.media === "optional-image") {
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
  if (!mediaOnly) await revealDrafts(client, job.workspace_id, job.content_item_ids);
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
  partial: { target: string; error: string }[];
}): Promise<StudioJobOutput> {
  const { client, job, type, parsed, platforms, ctx, input, angle, partial } = args;
  const title = String(parsed.title ?? "").trim() || input.intent.brief.slice(0, 80);

  const noteMissing = (missing: PlatformId[]) => {
    for (const p of missing)
      partial.push({ target: p, error: `No ${PLATFORMS[p].label} version came back.` });
  };

  switch (type) {
    case "social": {
      const { variants, missing } = finalizeVariants(platforms, parsed as never);
      if (!variants.length)
        throw new StudioJobError(502, "No platform versions came back. Try again.");
      noteMissing(missing);
      return { title, variants };
    }
    case "carousel": {
      const caption = String(parsed.caption ?? "");
      const hashtags = (parsed.hashtags as string[]) ?? [];
      return {
        title,
        slides: parsed.slides as StudioJobOutput["slides"],
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
        noteMissing(result.missing);
      } catch (err) {
        partial.push({ target: "captions", error: classify(err).message });
        variants = platforms.map((p) => finalizeVariant(p, { title, body: title, hashtags: [] }));
      }
      return {
        title,
        variants,
        ...({ concept: visual, altText: String(parsed.altText ?? "") } as object),
      };
    }
  }
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
      const check = await checkTask(task.taskId);
      if (check.state === "pending") continue;
      if (check.state === "failed") {
        recordTaskUsage({
          kind: task.kind,
          model: task.model,
          latencyMs: now - task.startedAt,
          ok: false,
        });
        const next = task.kind === "image" ? task.fallbacks[0] : undefined;
        if (next) {
          const size = IMAGE_SIZE_BY_RATIO[task.ratio] as KieImageSize;
          const restarted = await startImageTask({ prompt: task.prompt, size, model: next });
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
      const url = task.kind === "video" ? pickVideoUrl(check.urls).videoUrl : check.urls[0];
      if (!url) throw new Error("The provider returned no usable file.");
      const persisted = await persistAsset({
        workspaceId: row.workspace_id,
        idempotencyKey: `studio:${row.id}:${task.slot}:${task.taskId}`,
        sourceUrl: url,
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
        },
      });
      recordTaskUsage({
        kind: task.kind,
        model: task.model,
        latencyMs: Date.now() - task.startedAt,
        ok: true,
      });
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
    output: { ...row.output, media },
    asset_ids: [...new Set(assetIds)],
    lease_until: null,
    stage,
  };

  if (done) {
    const failed = media.filter((m) => m.status === "failed");
    const format = STUDIO_FORMATS[row.type];
    const mediaRequired = format.media === "image" || format.media === "video";
    const isRefine = !!row.parent_job_id;
    if (failed.length && mediaRequired && !media.some((m) => m.status === "ready")) {
      Object.assign(patch, {
        status: "failed",
        error: {
          category: "provider",
          message: failed[0].error ?? "The render failed.",
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
          partial: [
            ...(row.output?.partial ?? []),
            ...failed.map((m) => ({
              target: "media",
              error: m.error ?? "The visual failed to render.",
            })),
          ].filter(Boolean),
        },
      });
      await revealDrafts(c, row.workspace_id, row.content_item_ids);
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
