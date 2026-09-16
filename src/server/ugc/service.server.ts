// UGC Video Ads service: projects (product, brief, concepts, script), render
// start with an atomic allowance reservation, status views, cancel, download,
// "use in a post", and the provider callback. Routes call this after the
// kernel verified membership and role; project rows go through the caller's
// RLS client, render rows and reservations through the worker store.
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { UserSupabaseClient } from "@/integrations/supabase/client.user.server";
import type { Json } from "@/integrations/supabase/types";
import { checkRenderSettings, isUgcModelKey, UGC_MODELS, usableImageCount } from "@/lib/ugc/models";
import { platformPreset } from "@/lib/ugc/options";
import { buildVideoPrompt } from "@/lib/ugc/prompt";
import {
  ACTIVE_RENDER_STATUSES,
  BriefSchema,
  ConceptSchema,
  ProductSchema,
  ScriptSchema,
  type AllowanceView,
  type Brief,
  type Concept,
  type ProjectSummary,
  type ProjectView,
  type RenderView,
  type Script,
} from "@/lib/ugc/schemas";
import { BudgetExceededError } from "@/server/ai/budget";
import { ASSET_BUCKET } from "@/server/assets/persist.server";
import { getAppUrl } from "@/server/env";
import { HttpError } from "@/server/http-error";
import { getPlanLimits } from "@/server/plans";
import { createRenderEngine } from "./engine.server";
import {
  defaultModelKey,
  enabledModels,
  estimateRender,
  isModelEnabled,
  maxConcurrentRenders,
} from "./models.server";
import { kieVideoProvider } from "./providers/kie.server";
import type { RenderRow } from "./store";
import { RENDER_COLS, supabaseUgcStore } from "./store.supabase.server";

const WORKER = `ugc-${process.pid}-${randomUUID().slice(0, 8)}`;
const RESERVATION_TTL_SECONDS = 2 * 60 * 60;

/** Kie callbacks only reach a public HTTPS app with a signing key configured. */
export function kieCallbackUrl(): string | undefined {
  if (!process.env.KIE_WEBHOOK_HMAC_KEY?.trim()) return undefined;
  const app = getAppUrl();
  if (!/^https:\/\//i.test(app) || /localhost|127\.0\.0\.1/i.test(app)) return undefined;
  return `${app}/api/public/hooks/kie`;
}

export const renderEngine = createRenderEngine({
  store: supabaseUgcStore,
  provider: kieVideoProvider,
  callbackUrl: kieCallbackUrl,
});

/** Advance one render right after the response is sent (Vercel/Node after()). */
export function kickRender(id: string) {
  after(async () => {
    try {
      await renderEngine.runDue({ worker: WORKER, budgetMs: 25_000, max: 1, id });
    } catch (error) {
      console.error("[ugc] kick failed", error instanceof Error ? error.message : error);
    }
  });
}

export function runDueUgcRenders(opts: { budgetMs: number; max: number }) {
  return renderEngine.runDue({ worker: WORKER, ...opts });
}

/* ───────────────────────────── projects ───────────────────────────── */

const PROJECT_COLS =
  "id, workspace_id, title, product_url, product, brief, brand_snapshot, concepts, selected_concept_id, script, reference_asset_ids, status, created_at, updated_at";

type ProjectRow = {
  id: string;
  workspace_id: string;
  title: string;
  product_url: string | null;
  product: unknown;
  brief: unknown;
  brand_snapshot: unknown;
  concepts: unknown;
  selected_concept_id: string | null;
  script: unknown;
  reference_asset_ids: string[];
  status: string;
  created_at: string;
  updated_at: string;
};

const BRAND_FIELDS = [
  "brandName",
  "oneLiner",
  "about",
  "industry",
  "voice",
  "audience",
  "audienceTags",
  "values",
  "products",
  "doRules",
  "dontRules",
  "positioning",
  "uniqueValueProp",
  "websiteUrl",
] as const;

/** Keep only the Brand DNA fields the ad engine uses, size-capped. */
export function brandSnapshot(brand: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!brand) return out;
  for (const key of BRAND_FIELDS) {
    const v = brand[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 1200);
    else if (Array.isArray(v)) out[key] = v.filter((x) => typeof x === "string").slice(0, 10);
  }
  return out;
}

function parseConcepts(raw: unknown): Concept[] {
  return (Array.isArray(raw) ? raw : [])
    .map((c) => ConceptSchema.safeParse(c))
    .filter((r) => r.success)
    .map((r) => r.data!);
}

async function loadProjectRow(db: UserSupabaseClient, workspaceId: string, id: string) {
  const { data, error } = await db
    .from("ugc_projects")
    .select(PROJECT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "Ad project not found");
  return data as unknown as ProjectRow;
}

export async function createProject(
  db: UserSupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    title?: string;
    product: unknown;
    brief: unknown;
    brand?: Record<string, unknown>;
    referenceAssetIds: string[];
  },
) {
  const product = ProductSchema.parse(input.product);
  const brief = BriefSchema.parse(input.brief ?? {});
  const refs = await ownedImageAssetIds(input.workspaceId, input.referenceAssetIds);
  const { data, error } = await db
    .from("ugc_projects")
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      title: (input.title || product.name).slice(0, 200),
      product_url: product.url,
      product: product as unknown as Json,
      brief: brief as unknown as Json,
      brand_snapshot: brandSnapshot(input.brand) as Json,
      reference_asset_ids: refs,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the ad project");
  return getProjectView(db, input.workspaceId, data.id);
}

export async function updateProject(
  db: UserSupabaseClient,
  workspaceId: string,
  id: string,
  patch: {
    title?: string;
    product?: unknown;
    brief?: unknown;
    brand?: Record<string, unknown>;
    selectedConceptId?: string | null;
    script?: unknown;
    referenceAssetIds?: string[];
  },
) {
  await loadProjectRow(db, workspaceId, id);
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title.slice(0, 200) || "Untitled ad";
  if (patch.product !== undefined) {
    const product = ProductSchema.parse(patch.product);
    update.product = product;
    update.product_url = product.url;
  }
  if (patch.brief !== undefined) update.brief = BriefSchema.parse(patch.brief);
  if (patch.brand !== undefined) update.brand_snapshot = brandSnapshot(patch.brand);
  if (patch.selectedConceptId !== undefined) update.selected_concept_id = patch.selectedConceptId;
  if (patch.script !== undefined) update.script = patch.script === null ? null : ScriptSchema.parse(patch.script);
  if (patch.referenceAssetIds !== undefined) {
    update.reference_asset_ids = await ownedImageAssetIds(workspaceId, patch.referenceAssetIds);
  }
  if (Object.keys(update).length) {
    const { error } = await db
      .from("ugc_projects")
      .update(update as never)
      .eq("workspace_id", workspaceId)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  return getProjectView(db, workspaceId, id);
}

export async function saveConcepts(
  db: UserSupabaseClient,
  workspaceId: string,
  id: string,
  concepts: Concept[],
) {
  const first = concepts[0];
  const { error } = await db
    .from("ugc_projects")
    .update({
      concepts: concepts as unknown as Json,
      selected_concept_id: first?.id ?? null,
      script: (first?.script ?? null) as unknown as Json,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  return getProjectView(db, workspaceId, id);
}

export async function projectContext(db: UserSupabaseClient, workspaceId: string, id: string) {
  const row = await loadProjectRow(db, workspaceId, id);
  const { data: ws } = await db
    .from("workspaces")
    .select("industry, audience")
    .eq("id", workspaceId)
    .maybeSingle();
  return {
    row,
    product: ProductSchema.parse(row.product ?? {}),
    brief: BriefSchema.parse(row.brief ?? {}),
    brand: (row.brand_snapshot ?? {}) as Record<string, unknown>,
    script: row.script ? ScriptSchema.safeParse(row.script).data ?? null : null,
    workspace: (ws ?? {}) as { industry?: string | null; audience?: string | null },
  };
}

/** Image asset ids that really belong to this workspace and are stored. */
async function ownedImageAssetIds(workspaceId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)].slice(0, 9);
  if (!unique.length) return [];
  const db = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await db
    .from("assets")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("asset_type", "image")
    .eq("status", "ready")
    .is("deleted_at", null)
    .in("id", unique);
  if (error) throw new Error(error.message);
  const found = new Set(((data ?? []) as Array<{ id: string }>).map((a) => a.id));
  return unique.filter((id) => found.has(id));
}

async function signPaths(paths: string[], ttl = 3600): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map();
  const db = supabaseAdmin as unknown as SupabaseClient;
  const { data } = await db.storage.from(ASSET_BUCKET).createSignedUrls(unique, ttl);
  const out = new Map<string, string>();
  for (const s of data ?? []) if (s.path && s.signedUrl) out.set(s.path, s.signedUrl);
  return out;
}

async function assetPaths(workspaceId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { path: string; filename: string }>();
  const db = supabaseAdmin as unknown as SupabaseClient;
  const { data } = await db
    .from("assets")
    .select("id, storage_path, filename")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .in("id", [...new Set(ids)]);
  return new Map(
    ((data ?? []) as Array<{ id: string; storage_path: string | null; filename: string }>)
      .filter((a) => a.storage_path)
      .map((a) => [a.id, { path: a.storage_path as string, filename: a.filename }]),
  );
}

function presentRender(row: RenderRow, videoUrl: string | null, releasedHolds: Set<string>): RenderView {
  const script = row.script as { hook?: string };
  const model = isUgcModelKey(row.model_key) ? UGC_MODELS[row.model_key] : null;
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    model: row.model_key,
    modelName: model?.displayName ?? row.model_key,
    durationSec: row.duration_sec,
    aspectRatio: row.aspect_ratio,
    resolution: row.resolution,
    hook: script.hook ?? "",
    estCostUsd: row.est_cost_usd,
    actualCostUsd: row.actual_cost_usd,
    errorMessage: row.status === "failed" || row.status === "cancelled" ? row.error_message : null,
    allowanceReturned: Boolean(row.reservation_id && releasedHolds.has(row.reservation_id)),
    assetId: row.asset_id,
    videoUrl,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
  };
}

async function presentRenders(workspaceId: string, rows: RenderRow[]): Promise<RenderView[]> {
  const assets = await assetPaths(
    workspaceId,
    rows.map((r) => r.asset_id).filter((id): id is string => Boolean(id)),
  );
  const signed = await signPaths([...assets.values()].map((a) => a.path));
  const holdIds = rows.map((r) => r.reservation_id).filter((id): id is string => Boolean(id));
  const released = new Set<string>();
  if (holdIds.length) {
    const { data } = await supabaseAdmin
      .from("ai_usage_reservations")
      .select("id")
      .in("id", holdIds)
      .eq("state", "released");
    for (const h of data ?? []) released.add(h.id);
  }
  return rows.map((r) => {
    const asset = r.asset_id ? assets.get(r.asset_id) : undefined;
    return presentRender(r, asset ? (signed.get(asset.path) ?? null) : null, released);
  });
}

export async function getProjectView(
  db: UserSupabaseClient,
  workspaceId: string,
  id: string,
): Promise<ProjectView> {
  const row = await loadProjectRow(db, workspaceId, id);
  const { data: renderRows, error } = await db
    .from("ugc_renders")
    .select(RENDER_COLS)
    .eq("workspace_id", workspaceId)
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const refs = await assetPaths(workspaceId, row.reference_asset_ids ?? []);
  const signedRefs = await signPaths([...refs.values()].map((r) => r.path));
  const renders = await presentRenders(
    workspaceId,
    (renderRows ?? []).map((r) => ({
      ...(r as unknown as RenderRow),
      est_cost_usd: Number(r.est_cost_usd),
      actual_cost_usd: r.actual_cost_usd == null ? null : Number(r.actual_cost_usd),
      provider_meta: {},
      script: (r.script ?? {}) as Record<string, unknown>,
      settings: (r.settings ?? {}) as Record<string, unknown>,
    })),
  );
  const script = row.script ? ScriptSchema.safeParse(row.script) : null;
  return {
    id: row.id,
    title: row.title,
    productUrl: row.product_url,
    product: ProductSchema.parse(row.product ?? {}),
    brief: BriefSchema.parse(row.brief ?? {}),
    concepts: parseConcepts(row.concepts),
    selectedConceptId: row.selected_concept_id,
    script: script?.success ? script.data : null,
    references: (row.reference_asset_ids ?? []).map((assetId) => {
      const ref = refs.get(assetId);
      return {
        assetId,
        url: ref ? (signedRefs.get(ref.path) ?? null) : null,
        filename: ref?.filename ?? "image",
      };
    }),
    renders,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProjects(db: UserSupabaseClient, workspaceId: string): Promise<ProjectSummary[]> {
  const { data, error } = await db
    .from("ugc_projects")
    .select("id, title, product, reference_asset_ids, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    product: { name?: string; images?: Array<{ url: string }> } | null;
    reference_asset_ids: string[];
    updated_at: string;
  }>;
  const ids = rows.map((r) => r.id);
  const latest = new Map<string, { id: string; status: RenderView["status"]; asset_id: string | null }>();
  if (ids.length) {
    const { data: renders } = await db
      .from("ugc_renders")
      .select("id, project_id, status, asset_id, created_at")
      .eq("workspace_id", workspaceId)
      .in("project_id", ids)
      .order("created_at", { ascending: false })
      .limit(200);
    for (const r of renders ?? []) {
      if (!latest.has(r.project_id)) {
        latest.set(r.project_id, { id: r.id, status: r.status as RenderView["status"], asset_id: r.asset_id });
      }
    }
  }
  const assets = await assetPaths(
    workspaceId,
    [
      ...[...latest.values()].map((l) => l.asset_id),
      ...rows.map((r) => r.reference_asset_ids?.[0]),
    ].filter((id): id is string => Boolean(id)),
  );
  const signed = await signPaths([...assets.values()].map((a) => a.path));
  const urlFor = (assetId?: string | null) => {
    const a = assetId ? assets.get(assetId) : undefined;
    return a ? (signed.get(a.path) ?? null) : null;
  };
  return rows.map((r) => {
    const l = latest.get(r.id);
    return {
      id: r.id,
      title: r.title,
      productName: r.product?.name ?? r.title,
      thumbnailUrl: urlFor(r.reference_asset_ids?.[0]) ?? r.product?.images?.[0]?.url ?? null,
      latestRender: l ? { id: l.id, status: l.status, videoUrl: urlFor(l.asset_id) } : null,
      updatedAt: r.updated_at,
    };
  });
}

export async function archiveProject(db: UserSupabaseClient, workspaceId: string, id: string) {
  await loadProjectRow(db, workspaceId, id);
  const { error } = await db
    .from("ugc_projects")
    .update({ status: "archived" })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ───────────────────────────── renders ───────────────────────────── */

async function workspacePlan(workspaceId: string) {
  const { data } = await supabaseAdmin.from("workspaces").select("plan").eq("id", workspaceId).maybeSingle();
  return getPlanLimits((data as { plan?: string } | null)?.plan ?? null);
}

export async function startRender(
  db: UserSupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    projectId: string;
    idempotencyKey: string;
    model: string;
    durationSec: number;
    aspectRatio: string;
    resolution: string;
    referenceAssetIds: string[];
  },
): Promise<{ render: RenderView; created: boolean }> {
  const existing = await supabaseUgcStore.findByIdempotencyKey(input.workspaceId, input.idempotencyKey);
  if (existing) {
    if (existing.project_id !== input.projectId) throw new HttpError(409, "Duplicate request key");
    return { render: (await presentRenders(input.workspaceId, [existing]))[0], created: false };
  }

  const ctx = await projectContext(db, input.workspaceId, input.projectId);
  if (!ctx.script) throw new HttpError(400, "Choose a concept and finish the script before generating.");
  if (!isUgcModelKey(input.model) || !isModelEnabled(input.model)) {
    throw new HttpError(400, "That video model isn't available.");
  }
  const model = UGC_MODELS[input.model];
  const refs = await ownedImageAssetIds(input.workspaceId, input.referenceAssetIds);
  const imageCount = usableImageCount(model, refs.length);
  const settings = {
    model: model.key,
    durationSec: input.durationSec,
    aspectRatio: input.aspectRatio as (typeof model.aspectRatios)[number],
    resolution: input.resolution as (typeof model.resolutions)[number],
    imageCount,
  };
  const problems = checkRenderSettings(model, settings);
  if (problems.length) throw new HttpError(400, problems[0].message);

  const estimate = estimateRender(model, settings.resolution, settings.durationSec);
  const limits = await workspacePlan(input.workspaceId);
  const reservation = await supabaseUgcStore.reserve({
    scopeKey: `ws:${input.workspaceId}`,
    workspaceId: input.workspaceId,
    userId: input.userId,
    units: estimate.units,
    estCostUsd: estimate.usd,
    provider: "kie",
    model: model.providerVariant ? `${model.providerModel}:${model.providerVariant}` : model.providerModel,
    route: "ugc/renders:create",
    sourceId: `${input.workspaceId}:${input.idempotencyKey}`,
    ttlSeconds: RESERVATION_TTL_SECONDS,
    limits: {
      dailyUsd: limits.dailyUsd,
      monthlyUsd: limits.monthlyUsd,
      monthlyUnits: limits.monthlyVideos,
    },
    maxConcurrent: maxConcurrentRenders(),
  });
  if (!reservation.ok) {
    if (reservation.code === "concurrency") throw new HttpError(429, reservation.reason);
    throw new BudgetExceededError("video", reservation.reason);
  }

  const brandVoice =
    typeof ctx.brand.voice === "string" && ctx.brand.voice.trim() ? ctx.brand.voice : undefined;
  const prompt = buildVideoPrompt({
    product: ctx.product,
    brief: ctx.brief,
    script: ctx.script,
    model,
    durationSec: settings.durationSec,
    aspectRatio: settings.aspectRatio,
    imageCount,
    brandVoice,
  });

  let inserted;
  try {
    inserted = await supabaseUgcStore.insertRender({
      id: randomUUID(),
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      created_by: input.userId,
      idempotency_key: input.idempotencyKey,
      model_key: model.key,
      provider: kieVideoProvider.id,
      provider_model: model.providerModel,
      provider_variant: model.providerVariant ?? null,
      generation_type: kieVideoProvider.generationType(model, imageCount),
      duration_sec: settings.durationSec,
      aspect_ratio: settings.aspectRatio,
      resolution: settings.resolution,
      audio: model.nativeAudio,
      reference_asset_ids: refs.slice(0, imageCount),
      script: ctx.script as unknown as Record<string, unknown>,
      settings: {
        platform: platformPreset(ctx.brief.platform).id,
        objective: ctx.brief.objective,
        format: ctx.brief.format,
        tone: ctx.brief.tone,
        language: ctx.brief.language,
        estCredits: estimate.credits,
        videoUnits: estimate.units,
      },
      prompt,
      reservation_id: reservation.id,
      est_cost_usd: estimate.usd,
    });
  } catch (error) {
    await supabaseUgcStore.release(reservation.id, "insert_failed").catch(() => {});
    throw error;
  }
  if (inserted.created) kickRender(inserted.row.id);
  return { render: (await presentRenders(input.workspaceId, [inserted.row]))[0], created: inserted.created };
}

async function loadRender(db: UserSupabaseClient, workspaceId: string, id: string) {
  // RLS read proves membership; the worker store holds the full row.
  const { data, error } = await db
    .from("ugc_renders")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "Render not found");
  const row = await supabaseUgcStore.getRender(id);
  if (!row) throw new HttpError(404, "Render not found");
  return row;
}

/**
 * Read a render. If it is due and nobody holds its lease (no cron locally, a
 * lost after()), advance it once here — a status read can move work forward
 * but never runs it twice.
 */
export async function getRenderView(db: UserSupabaseClient, workspaceId: string, id: string) {
  let row = await loadRender(db, workspaceId, id);
  if (
    ACTIVE_RENDER_STATUSES.includes(row.status) &&
    Date.parse(row.next_attempt_at) <= Date.now() &&
    (!row.lease_until || Date.parse(row.lease_until) < Date.now())
  ) {
    await renderEngine.runDue({ worker: WORKER, budgetMs: 20_000, max: 1, id });
    row = (await supabaseUgcStore.getRender(id)) ?? row;
  }
  return (await presentRenders(workspaceId, [row]))[0];
}

export async function cancelRender(db: UserSupabaseClient, workspaceId: string, id: string) {
  const row = await loadRender(db, workspaceId, id);
  const result = await renderEngine.cancel(row);
  if (!result.ok) {
    throw new HttpError(
      409,
      result.row.status === "processing" || result.row.status === "persisting"
        ? "This video is already rendering and can't be stopped."
        : "This render has already finished.",
    );
  }
  return (await presentRenders(workspaceId, [result.row]))[0];
}

export async function renderDownload(db: UserSupabaseClient, workspaceId: string, id: string) {
  const row = await loadRender(db, workspaceId, id);
  if (row.status !== "succeeded" || !row.asset_id) throw new HttpError(409, "This video isn't ready yet.");
  const asset = (await assetPaths(workspaceId, [row.asset_id])).get(row.asset_id);
  if (!asset) throw new HttpError(404, "The stored video was not found.");
  const db2 = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await db2.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(asset.path, 300, { download: asset.filename });
  if (error || !data) throw new Error(error?.message ?? "Could not sign the download");
  return { url: data.signedUrl, filename: asset.filename };
}

const CHANNEL_BY_PLATFORM: Record<string, string> = {
  tiktok: "tiktok",
  reels: "instagram",
  shorts: "youtube",
  facebook: "facebook",
};

/** Create a draft post carrying the video and its caption (Mellox's publishing flow). */
export async function createPostDraft(db: UserSupabaseClient, workspaceId: string, id: string, userId: string) {
  const row = await loadRender(db, workspaceId, id);
  if (row.status !== "succeeded" || !row.asset_id) throw new HttpError(409, "This video isn't ready yet.");
  const existingId = typeof row.provider_meta.contentItemId === "string" ? row.provider_meta.contentItemId : null;
  if (existingId) return { contentItemId: existingId };
  const asset = (await assetPaths(workspaceId, [row.asset_id])).get(row.asset_id);
  const script = ScriptSchema.safeParse(row.script);
  const platform = String(row.settings.platform ?? "tiktok");
  const channel = CHANNEL_BY_PLATFORM[platform] ?? "tiktok";
  const s: Script | null = script.success ? script.data : null;
  const { data, error } = await db
    .from("content_items")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      agent: "spark",
      kind: "video",
      channel,
      title: (s?.hook ?? "UGC video ad").slice(0, 200),
      body: s?.postCaption || s?.hook || "",
      hashtags: s?.hashtags ?? [],
      status: "draft",
      meta: {
        source: "ugc",
        studio_type: "ugc",
        platform: channel,
        ugc_project_id: row.project_id,
        ugc_render_id: row.id,
        asset_id: row.asset_id,
        asset_storage_path: asset?.path ?? null,
        asset_status: "ready",
        media_type: "video",
      },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the post draft");
  await supabaseUgcStore.transition(row.id, ["succeeded"], {
    provider_meta: { ...row.provider_meta, contentItemId: data.id },
  });
  return { contentItemId: data.id };
}

export async function getAllowance(workspaceId: string): Promise<AllowanceView> {
  const limits = await workspacePlan(workspaceId);
  const [summary, holds, active] = await Promise.all([
    supabaseAdmin.rpc("ai_usage_summary", { p_scope_key: `ws:${workspaceId}` }),
    supabaseAdmin
      .from("ai_usage_reservations")
      .select("units, kind")
      .eq("workspace_id", workspaceId)
      .eq("state", "held")
      .gt("expires_at", new Date().toISOString()),
    supabaseAdmin
      .from("ugc_renders")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("status", [...ACTIVE_RENDER_STATUSES]),
  ]);
  const s = (Array.isArray(summary.data) ? summary.data[0] : summary.data) as
    | { month_videos?: number; month_cost_usd?: number; today_cost_usd?: number }
    | undefined;
  const held = (holds.data ?? [])
    .filter((h) => h.kind === "video")
    .reduce((n, h) => n + Number(h.units ?? 0), 0);
  const monthVideos = Number(s?.month_videos ?? 0);
  return {
    plan: limits.id,
    // ai_usage_summary already includes live holds; report them separately.
    videos: { used: Math.max(0, monthVideos - held), held, limit: limits.monthlyVideos },
    spend: {
      monthUsd: Number(s?.month_cost_usd ?? 0),
      monthlyLimitUsd: limits.monthlyUsd,
      todayUsd: Number(s?.today_cost_usd ?? 0),
      dailyLimitUsd: limits.dailyUsd,
    },
    activeRenders: active.count ?? 0,
    maxConcurrent: maxConcurrentRenders(),
  };
}

export function modelCatalog() {
  return { models: enabledModels(), defaultModel: defaultModelKey() };
}

export type { Brief };
