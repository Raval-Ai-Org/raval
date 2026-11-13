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
import {
  checkRenderSettings,
  isKnownUgcModelKey,
  isUgcModelKey,
  resolveUgcModel,
  usableImageCount,
  type UgcModelKey,
} from "@/lib/ugc/models";
import { platformPreset } from "@/lib/ugc/options";
import { buildModelPrompt } from "@/lib/ugc/prompt-adapters";
import { styleBlockFor, ugcStyleNotes } from "@/lib/brand-look/prompt";
import { loadBrandLook } from "@/server/brand-look/resolve.server";
import { routeVideo } from "@/lib/ugc/router";
import { stockCreator } from "@/lib/ugc/creators";
import {
  creatorFormatSettings,
  formatForRender,
  pickPartner,
  type FormatVariant,
} from "@/lib/ugc/formats";
import { log } from "@/server/observability/logger";
import { stockCreatorAsset } from "./creator-photo.server";
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
import { signStoragePath, signStoragePaths } from "@/server/assets/storage.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { getAppUrl } from "@/server/env";
import { HttpError } from "@/server/http-error";
import { getPlanLimits } from "@/server/plans";
import { getEntitlements } from "@/server/billing/entitlements.server";
import { videoFeatureFor, type VideoResolution } from "@/lib/billing/catalog";
import { settleUgcBilling } from "@/server/billing/ugc-async.server";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import { createRenderEngine } from "./engine.server";
import {
  activeModel,
  defaultModelKey,
  enabledModels,
  estimateRender,
  isModelEnabled,
  maxConcurrentRenders,
} from "./models.server";
import { routedVideoProvider } from "./providers/routed.server";
import type { RenderRow } from "./store";
import { RENDER_COLS, supabaseUgcStore } from "./store.supabase.server";
import { signRenderRef } from "./webhook.server";

const WORKER = `ugc-${process.pid}-${randomUUID().slice(0, 8)}`;
const RESERVATION_TTL_SECONDS = 2 * 60 * 60;

/** Kie callbacks only reach a public HTTPS app with a signing key configured. */
export function kieCallbackUrl(renderId?: string): string | undefined {
  const key = process.env.KIE_WEBHOOK_HMAC_KEY?.trim();
  if (!key) return undefined;
  const app = getAppUrl();
  if (!/^https:\/\//i.test(app) || /localhost|127\.0\.0\.1/i.test(app)) return undefined;
  const url = `${app}/api/public/hooks/kie`;
  // Naming the render lets a task whose create call timed out be found by its
  // callback instead of being paid for twice (engine `adopt`).
  return renderId ? `${url}?render=${renderId}&ref=${signRenderRef(renderId, key)}` : url;
}

export const renderEngine = createRenderEngine({
  visualContext: async (row) => {
    const { loadGenerationVisualSnapshot, resolveVisualReferenceUrls } =
      await import("@/server/brand-visuals/service.server");
    const snapshot =
      (row.provider_meta.visualTaste as
        import("@/lib/brand-visuals/contracts").VisualSnapshot | undefined) ??
      (await loadGenerationVisualSnapshot(row.workspace_id, "ugc"));
    if (snapshot && !row.provider_meta.visualTaste) {
      const { applyVisualTaste } = await import("@/lib/brand-visuals/apply");
      const { visualStyleBlock, videoStyleBlock } = await import("@/lib/brand-look/prompt");
      const loaded = await loadBrandLook(row.workspace_id);
      const resolved = applyVisualTaste(loaded.look, loaded.dna?.look, snapshot);
      snapshot.direction = {
        ...snapshot.direction,
        visual: resolved.visual,
        video: resolved.video,
      };
      snapshot.rules = `${snapshot.rules}\n\nRequired resolved visual settings:\n${visualStyleBlock(resolved)}\n${videoStyleBlock(resolved)}`;
    }
    return snapshot
      ? {
          rules: snapshot.rules,
          urls: await resolveVisualReferenceUrls(row.workspace_id, snapshot),
          snapshot,
        }
      : null;
  },
  store: supabaseUgcStore,
  provider: routedVideoProvider,
  callbackUrl: (row) => kieCallbackUrl(row.id),
  onTerminal: settleUgcBilling,
  // Reels-style hook text (src/lib/ugc/hook-text.ts), drawn by code on the finished video.
  drawHookText: async (video, cues, row) => {
    let dataUrl = video.dataUrl;
    if (!dataUrl) {
      const { safeFetch } = await import("@/server/safe-fetch");
      const response = await safeFetch(video.videoUrl, {
        timeoutMs: 30_000,
        maxBytes: 120 * 1024 * 1024,
        onOverflow: "error",
      });
      if (!response.ok) return null;
      dataUrl = `data:video/mp4;base64,${Buffer.from(response.bytes).toString("base64")}`;
    }
    const { overlayHookText } = await import("@/server/studio/video/finish.server");
    const accent = (row.settings.hookText as { accent?: unknown } | undefined)?.accent;
    return overlayHookText(dataUrl, cues, {
      font: "Montserrat",
      ...(typeof accent === "string" ? { accent } : {}),
    });
  },
});

/** Advance one render right after the response is sent (Vercel/Node after()). */
export function kickRender(id: string) {
  try {
    after(async () => {
      try {
        await renderEngine.runDue({ worker: WORKER, budgetMs: 25_000, max: 1, id });
      } catch (error) {
        console.error("[ugc] kick failed", error instanceof Error ? error.message : error);
      }
    });
  } catch {
    // Outside a request scope (scripts, workers): the cron hook and status reads advance it.
  }
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

const CUSTOMER_FIELDS = [
  ["painPoints", "customerPainPoints"],
  ["objections", "customerObjections"],
  ["buyingTriggers", "customerBuyingTriggers"],
  ["jobsToBeDone", "customerJobsToBeDone"],
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
  // The customer's own words (Brand DNA's customer block): what hurts, what
  // holds them back and what makes them buy are what a creator video is built on.
  const customer = brand.customer;
  if (customer && typeof customer === "object" && !Array.isArray(customer)) {
    for (const [field, key] of CUSTOMER_FIELDS) {
      const v = (customer as Record<string, unknown>)[field];
      if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 600);
    }
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
    script?: unknown;
    referenceAssetIds: string[];
  },
) {
  const product = ProductSchema.parse(input.product);
  const brief = BriefSchema.parse(input.brief ?? {});
  const script = input.script ? ScriptSchema.parse(input.script) : null;
  const refs = await ownedImageAssetIds(input.workspaceId, input.referenceAssetIds);
  const brand = await workspaceBrand(db, input.workspaceId);
  const { data, error } = await db
    .from("ugc_projects")
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      title: (input.title || product.name).slice(0, 200),
      product_url: product.url,
      product: product as unknown as Json,
      brief: brief as unknown as Json,
      script: script as unknown as Json,
      brand_snapshot: brand as Json,
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
  if (patch.selectedConceptId !== undefined) update.selected_concept_id = patch.selectedConceptId;
  if (patch.script !== undefined)
    update.script = patch.script === null ? null : ScriptSchema.parse(patch.script);
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
  brand: Record<string, unknown>,
) {
  const first = concepts[0];
  const { error } = await db
    .from("ugc_projects")
    .update({
      brand_snapshot: brand as Json,
      concepts: concepts as unknown as Json,
      selected_concept_id: first?.id ?? null,
      script: (first?.script ?? null) as unknown as Json,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  return getProjectView(db, workspaceId, id);
}

/** The workspace's saved Brand DNA (server-side, by verified workspace id), trimmed for ads. */
async function workspaceBrand(db: UserSupabaseClient, workspaceId: string) {
  const stored = await readBrandDna(db as unknown as SupabaseClient, workspaceId);
  return brandSnapshot(stored?.dna);
}

/**
 * The plan a Creator video follows, the same blocks every Studio piece gets
 * (`loadStudioContext`): the confirmed strategy, running campaigns, the goal
 * and the audience groups, all by the verified workspace id. Each part fails
 * open to "" so a missing brain never stops a script.
 */
async function creatorPlanText(workspaceId: string): Promise<string> {
  const safe = (p: Promise<string>) => p.catch(() => "");
  const parts = await Promise.all([
    safe(import("@/server/strategy/context.server").then((m) => m.strategyBlockFor(workspaceId))),
    safe(import("@/server/campaigns/context.server").then((m) => m.campaignBlockFor(workspaceId))),
    safe(import("@/server/goals/context.server").then((m) => m.goalBlockFor(workspaceId))),
    safe(import("@/server/audience/context.server").then((m) => m.audienceBlockFor(workspaceId))),
  ]);
  return parts.filter((t) => t.trim()).join("\n\n");
}

export async function projectContext(db: UserSupabaseClient, workspaceId: string, id: string) {
  const row = await loadProjectRow(db, workspaceId, id);
  const brief = BriefSchema.parse(row.brief ?? {});
  const [{ data: ws }, brand, style, memoryText, planText] = await Promise.all([
    db.from("workspaces").select("industry, audience").eq("id", workspaceId).maybeSingle(),
    workspaceBrand(db, workspaceId),
    projectLook(workspaceId),
    // What the team told Mellox to remember (ADR-0033). "" when off or unset.
    import("@/server/memory/context.server").then((m) => m.memoryBlockFor(workspaceId, "text")),
    creatorPlanText(workspaceId),
  ]);
  return {
    row,
    memoryText,
    planText,
    product: ProductSchema.parse(row.product ?? {}),
    brief,
    style,
    styleText: style ? styleBlockFor(style.look, "ugc") : "",
    styleNotes: style ? ugcStyleNotes(style.look) : "",
    brand: Object.keys(brand).length
      ? brand
      : ((row.brand_snapshot ?? {}) as Record<string, unknown>),
    script: row.script ? (ScriptSchema.safeParse(row.script).data ?? null) : null,
    workspace: (ws ?? {}) as { industry?: string | null; audience?: string | null },
  };
}

/**
 * What this brand's Creator videos used lately (with the caller's own client):
 * openings not to repeat, and per format the variants to rotate past. Never
 * throws; a failed read just means nothing to avoid.
 */
export async function recentCreatorWork(
  db: UserSupabaseClient,
  workspaceId: string,
): Promise<{ hooks: string[]; variants: Record<string, FormatVariant[]> }> {
  const out = { hooks: [] as string[], variants: {} as Record<string, FormatVariant[]> };
  try {
    const { data } = await db
      .from("ugc_projects")
      .select("script, concepts")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(15);
    for (const row of (data ?? []) as Array<{ script: unknown; concepts: unknown }>) {
      const scripts = [
        row.script,
        ...(Array.isArray(row.concepts)
          ? row.concepts.map((c) => (c as { script?: unknown })?.script)
          : []),
      ];
      for (const raw of scripts) {
        const parsed = ScriptSchema.safeParse(raw);
        if (!parsed.success) continue;
        const s = parsed.data;
        if (s.hook && !out.hooks.includes(s.hook)) out.hooks.push(s.hook);
        if (s.format && s.variant) (out.variants[s.format] ??= []).push(s.variant);
      }
    }
  } catch (error) {
    log.warn("ugc.recent_work.unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  out.hooks = out.hooks.slice(0, 20);
  return out;
}

/**
 * The brand's look for a UGC project (by the verified workspace id). Never
 * throws — no look just means Brand DNA only.
 */
async function projectLook(workspaceId: string) {
  try {
    const loaded = await loadBrandLook(workspaceId);
    return loaded.look.customized ? loaded : null;
  } catch {
    return null;
  }
}

/**
 * A brief with no creator picked follows the brand's own creator
 * (`look.video.creator`, Inspo / the creator picker). Never throws.
 */
async function withBrandCreator(workspaceId: string, brief: Brief): Promise<Brief> {
  if (brief.creator.characterId || brief.creator.personAssetId) return brief;
  try {
    const chosen = (await loadBrandLook(workspaceId)).look.video.creator;
    if (chosen?.id && stockCreator(chosen.id)) {
      const stock = stockCreator(chosen.id)!;
      return {
        ...brief,
        creator: {
          ...brief.creator,
          characterId: stock.id,
          gender: stock.gender,
          age: stock.age,
          vibe: stock.vibe,
        },
      };
    }
    if (chosen?.personAssetId)
      return { ...brief, creator: { ...brief.creator, personAssetId: chosen.personAssetId } };
  } catch {
    // No look: the brief's own creator settings stand.
  }
  return brief;
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
  return signStoragePaths(db, unique, ttl);
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
      .filter((a) => isWorkspaceStoragePath(a.storage_path, workspaceId))
      .map((a) => [a.id, { path: a.storage_path as string, filename: a.filename }]),
  );
}

function presentRender(
  row: RenderRow,
  videoUrl: string | null,
  releasedHolds: Set<string>,
): RenderView {
  const script = row.script as { hook?: string };
  const model = isKnownUgcModelKey(row.model_key) ? resolveUgcModel(row.model_key) : null;
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

export async function listProjects(
  db: UserSupabaseClient,
  workspaceId: string,
): Promise<ProjectSummary[]> {
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
  const latest = new Map<
    string,
    { id: string; status: RenderView["status"]; asset_id: string | null }
  >();
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
        latest.set(r.project_id, {
          id: r.id,
          status: r.status as RenderView["status"],
          asset_id: r.asset_id,
        });
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
  const { data } = await supabaseAdmin
    .from("workspaces")
    .select("plan")
    .eq("id", workspaceId)
    .maybeSingle();
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
  options: { deferKick?: boolean } = {},
): Promise<{ render: RenderView; created: boolean; providerCostUsd: number }> {
  const existing = await supabaseUgcStore.findByIdempotencyKey(
    input.workspaceId,
    input.idempotencyKey,
  );
  if (existing) {
    if (existing.project_id !== input.projectId) throw new HttpError(409, "Duplicate request key");
    return {
      render: (await presentRenders(input.workspaceId, [existing]))[0],
      created: false,
      providerCostUsd: existing.est_cost_usd,
    };
  }

  const ctx = await projectContext(db, input.workspaceId, input.projectId);
  if (!ctx.script)
    throw new HttpError(400, "Choose a concept and finish the script before generating.");
  const brief = await withBrandCreator(input.workspaceId, ctx.brief);
  const productRefs = await ownedImageAssetIds(input.workspaceId, input.referenceAssetIds);
  // One of the brand's own people as the creator: re-checked against this workspace.
  // A ready-made creator with a photo sends that photo, so every video shows the same face.
  const person = brief.creator.personAssetId
    ? ((await ownedImageAssetIds(input.workspaceId, [brief.creator.personAssetId]))[0] ?? null)
    : brief.creator.characterId
      ? await stockCreatorAsset(input.workspaceId, brief.creator.characterId)
      : null;
  // A library format (ADR-0046). Its second person is the one picked, else a
  // ready-made creator code picks to contrast with the lead, seeded by the project.
  const format = formatForRender(brief, ctx.script);
  const partnerId =
    format?.roles.length === 2
      ? (brief.creator.partnerId ?? pickPartner(brief.creator.characterId, input.projectId).id)
      : undefined;
  const partner = partnerId ? await stockCreatorAsset(input.workspaceId, partnerId) : null;
  const requestedModel = isUgcModelKey(input.model) ? input.model : "auto";
  const entitlements = await getEntitlements({
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: "editor",
  });
  const candidates = enabledModels().filter(
    (candidate) =>
      requestedModel !== "auto" ||
      (candidate.aspectRatios.includes(
        input.aspectRatio as (typeof candidate.aspectRatios)[number],
      ) &&
        candidate.resolutions.includes(
          input.resolution as (typeof candidate.resolutions)[number],
        ) &&
        (entitlements.enforcement !== "on" ||
          entitlements.features[
            videoFeatureFor(candidate.key as UgcModelKey, input.resolution as VideoResolution)
          ].allowed)),
  );
  if (!candidates.length)
    throw new HttpError(400, "No video model supports these settings on your plan.");
  const route = routeVideo(
    {
      product: ctx.product,
      brief,
      script: ctx.script,
      platform: brief.platform,
      durationSec: input.durationSec,
      referenceCount: productRefs.length + (person ? 1 : 0) + (partner ? 1 : 0),
      brand: ctx.brand,
      requestedModel,
    },
    candidates.map((candidate) => candidate.key as UgcModelKey),
  );
  if (!isModelEnabled(route.model))
    throw new HttpError(400, "No suitable video model is available.");
  // Validated against the provider that will run it (VIDEO_PROVIDER).
  const model = activeModel(route.model);
  // The person photo goes first, only to a model that takes several references;
  // a first-frame model opens on the product and the creator is described instead.
  const withPerson = !!person && model.images?.mode === "references" && model.images.max >= 2;
  // The second person's photo comes right after the first, on a model with room for both.
  const withPartner = withPerson && !!partner && partner !== person && model.images!.max >= 3;
  const people = [person, ...(withPartner ? [partner] : [])].filter((id): id is string => !!id);
  const refs = withPerson
    ? [...people, ...productRefs.filter((id) => !people.includes(id))]
    : productRefs.filter((id) => id !== person);
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

  const estimate = estimateRender(model, settings.resolution, settings.durationSec, imageCount);
  const enforcing = entitlements.enforcement === "on";
  const limits = enforcing ? null : await workspacePlan(input.workspaceId);
  const configuredCap = Number(process.env.UGC_MAX_CONCURRENT_RENDERS);
  const concurrent = enforcing
    ? Math.min(
        entitlements.limits.maxConcurrentRenders,
        Number.isFinite(configuredCap) && configuredCap > 0 ? Math.floor(configuredCap) : Infinity,
      )
    : maxConcurrentRenders();
  const reservation = await supabaseUgcStore.reserve({
    scopeKey: enforcing ? `acct:${entitlements.accountId}` : `ws:${input.workspaceId}`,
    workspaceId: input.workspaceId,
    userId: input.userId,
    units: estimate.units,
    estCostUsd: estimate.usd,
    provider: model.provider,
    model: model.providerVariant
      ? `${model.providerModel}:${model.providerVariant}`
      : model.providerModel,
    route: "ugc/renders:create",
    sourceId: `${input.workspaceId}:${input.idempotencyKey}`,
    ttlSeconds: RESERVATION_TTL_SECONDS,
    limits: {
      dailyUsd: limits?.dailyUsd ?? 1_000_000,
      monthlyUsd: limits?.monthlyUsd ?? 1_000_000,
      monthlyUnits: limits?.monthlyVideos ?? 1_000_000,
    },
    maxConcurrent: concurrent,
  });
  if (!reservation.ok) {
    if (reservation.code === "concurrency") throw new HttpError(429, reservation.reason);
    throw new BudgetExceededError("video", reservation.reason);
  }

  const brandVoice =
    typeof ctx.brand.voice === "string" && ctx.brand.voice.trim() ? ctx.brand.voice : undefined;
  const prompt = buildModelPrompt({
    product: ctx.product,
    brief,
    script: ctx.script,
    model,
    durationSec: settings.durationSec,
    aspectRatio: settings.aspectRatio,
    imageCount,
    brandVoice,
    styleNotes: ctx.styleNotes || undefined,
    creatorImage: withPerson,
    partnerImage: withPartner,
    partnerId,
    seed: input.projectId,
  });
  const formatSettings = creatorFormatSettings({
    brief,
    script: ctx.script,
    format,
    durationSec: settings.durationSec,
    seed: input.projectId,
    accent: ctx.style?.look.visual.palette.accent ?? ctx.style?.look.visual.palette.primary,
  });

  let inserted;
  try {
    inserted = await supabaseUgcStore.insertRender({
      id: randomUUID(),
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      created_by: input.userId,
      idempotency_key: input.idempotencyKey,
      billing_ready: !options.deferKick,
      model_key: model.key,
      // The planned provider; submit records the one that actually accepted it.
      provider: model.provider,
      provider_model: model.providerModel,
      provider_variant: model.providerVariant ?? null,
      generation_type: routedVideoProvider.generationType(model, imageCount),
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
        routing: { reason: route.reason, signals: route.signals, strategy: route.strategy },
        ...formatSettings,
      },
      prompt,
      reservation_id: reservation.id,
      est_cost_usd: estimate.usd,
    });
  } catch (error) {
    await supabaseUgcStore.release(reservation.id, "insert_failed").catch(() => {});
    throw error;
  }
  if (inserted.created && !options.deferKick) kickRender(inserted.row.id);
  return {
    render: (await presentRenders(input.workspaceId, [inserted.row]))[0],
    created: inserted.created,
    providerCostUsd: inserted.row.est_cost_usd,
  };
}

/** Make a queued render claimable only after its billing link has been saved. */
export async function activateUgcRender(id: string): Promise<void> {
  const { ugcBillingColumnReady } = await import("@/server/billing/schema.server");
  if (!(await ugcBillingColumnReady())) {
    const legacy = await supabaseUgcStore.getRender(id);
    if (!legacy || legacy.status !== "queued")
      throw new HttpError(503, "Could not activate video render.");
    return;
  }
  const row = await supabaseUgcStore.transition(id, ["queued"], { billing_ready: true });
  if (!row) throw new HttpError(503, "Could not activate video render.");
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
  await settleUgcBilling(row);
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
  if (row.status !== "succeeded" || !row.asset_id)
    throw new HttpError(409, "This video isn't ready yet.");
  const asset = (await assetPaths(workspaceId, [row.asset_id])).get(row.asset_id);
  if (!asset) throw new HttpError(404, "The stored video was not found.");
  const db2 = supabaseAdmin as unknown as SupabaseClient;
  const url = await signStoragePath(db2, asset.path, 300, asset.filename);
  if (!url) throw new Error("Could not sign the download");
  return { url, filename: asset.filename };
}

const CHANNEL_BY_PLATFORM: Record<string, string> = {
  tiktok: "tiktok",
  reels: "instagram",
  shorts: "youtube",
  facebook: "facebook",
};

/** Create a draft post carrying the video and its caption (Mellox's publishing flow). */
export async function createPostDraft(
  db: UserSupabaseClient,
  workspaceId: string,
  id: string,
  userId: string,
) {
  const row = await loadRender(db, workspaceId, id);
  if (row.status !== "succeeded" || !row.asset_id)
    throw new HttpError(409, "This video isn't ready yet.");
  const existingId =
    typeof row.provider_meta.contentItemId === "string" ? row.provider_meta.contentItemId : null;
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
        studio_type: "video",
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
    { month_videos?: number } | undefined;
  const held = (holds.data ?? [])
    .filter((h) => h.kind === "video")
    .reduce((n, h) => n + Number(h.units ?? 0), 0);
  const monthVideos = Number(s?.month_videos ?? 0);
  return {
    plan: limits.id,
    // ai_usage_summary already includes live holds; report them separately.
    videos: { used: Math.max(0, monthVideos - held), held, limit: limits.monthlyVideos },
    activeRenders: active.count ?? 0,
    maxConcurrent: maxConcurrentRenders(),
  };
}

export function modelCatalog() {
  return { models: enabledModels(), defaultModel: defaultModelKey() };
}

/* ── Storyboard before a Creator video (src/lib/studio/video/board.ts) ── */

const STORYBOARD_SOURCE = "ugc-storyboard";

export type CreatorStoryboardView = {
  key: string;
  /** Drawn frames by slot (`board:0`…), signed for an hour. */
  frames: Record<string, string>;
  /** True when these frames were drawn before and nothing was charged. */
  reused: boolean;
};

function creatorFramePrompt(args: {
  scene: import("@/lib/studio/video/board").BoardScene;
  creatorLook: string;
  productName: string;
  setting: string;
}): string {
  return [
    `A single frame of real phone footage for a short creator video, scene ${args.scene.number}: ${args.scene.action}`,
    args.scene.camera ? `Camera: ${args.scene.camera}.` : "",
    args.creatorLook ? `The creator: ${args.creatorLook}. The same person in every frame.` : "",
    args.productName
      ? `The product, ${args.productName}, exactly as in the product reference.`
      : "",
    args.setting && args.setting !== "auto" ? `Place: ${args.setting}.` : "",
    "Natural light, handheld vertical phone video, real and unpolished, not an advertisement. No words, captions, logos, subtitles or interface.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Frames already drawn for exactly this script (no charge to show them again). */
async function storedCreatorFrames(
  workspaceId: string,
  projectId: string,
  key: string,
): Promise<Record<string, string>> {
  const db = supabaseAdmin as unknown as SupabaseClient;
  const { data } = await db
    .from("assets")
    .select("storage_path, metadata")
    .eq("workspace_id", workspaceId)
    .eq("status", "ready")
    .is("deleted_at", null)
    .eq("metadata->>source", STORYBOARD_SOURCE)
    .eq("metadata->>project_id", projectId)
    .eq("metadata->>board_key", key);
  const rows = ((data ?? []) as Array<{ storage_path: string | null; metadata: Json }>).filter(
    (row) => isWorkspaceStoragePath(row.storage_path, workspaceId),
  );
  const signed = await signPaths(rows.map((row) => row.storage_path as string));
  const out: Record<string, string> = {};
  for (const row of rows) {
    const slot = (row.metadata as Record<string, unknown> | null)?.slot;
    const url = signed.get(row.storage_path as string);
    if (typeof slot === "string" && url) out[slot] = url;
  }
  return out;
}

/**
 * The storyboard of a Creator video before it is made: the saved script's
 * scenes (code, free) and one low-quality frame per picked scene with the
 * creator's photo and the product's photo as references. Drawn once per
 * script: the same script shows its stored frames again for nothing.
 * `charge` runs only when new frames are drawn.
 */
export async function creatorStoryboard(
  db: UserSupabaseClient,
  input: { workspaceId: string; projectId: string; aspectRatio: string },
  charge: (draw: () => Promise<Record<string, string>>) => Promise<Record<string, string>>,
): Promise<CreatorStoryboardView> {
  const { boardFromCreatorScript, creatorBoardKey } = await import("@/lib/studio/video/board");
  const ctx = await projectContext(db, input.workspaceId, input.projectId);
  if (!ctx.script) throw new HttpError(400, "Write what the creator says first.");
  const board = boardFromCreatorScript(ctx.script);
  const key = `${creatorBoardKey(board)}-${input.aspectRatio.replace(":", "x")}`;
  const stored = await storedCreatorFrames(input.workspaceId, input.projectId, key);
  const wanted = board.scenes.filter((scene) => scene.frameSlot);
  if (wanted.every((scene) => stored[scene.frameSlot!]))
    return { key, frames: stored, reused: true };

  const brief = await withBrandCreator(input.workspaceId, ctx.brief);
  const stock = brief.creator.characterId ? stockCreator(brief.creator.characterId) : null;
  const person = brief.creator.personAssetId
    ? ((await ownedImageAssetIds(input.workspaceId, [brief.creator.personAssetId]))[0] ?? null)
    : brief.creator.characterId
      ? await stockCreatorAsset(input.workspaceId, brief.creator.characterId)
      : null;
  const productRefs = await ownedImageAssetIds(
    input.workspaceId,
    (ctx.row.reference_asset_ids ?? []).slice(0, 1),
  );
  const paths = await assetPaths(input.workspaceId, [...(person ? [person] : []), ...productRefs]);
  const signed = await signPaths([...paths.values()].map((p) => p.path));
  const references = [...paths.values()]
    .map((p) => signed.get(p.path))
    .filter((url): url is string => !!url);
  const size: "1792x1024" | "1024x1024" | "1024x1792" =
    input.aspectRatio === "16:9"
      ? "1792x1024"
      : input.aspectRatio === "1:1"
        ? "1024x1024"
        : "1024x1792";

  const frames = await charge(async () => {
    const { generateImage } = await import("@/lib/openrouter-image.server");
    const { persistAsset } = await import("@/server/assets/persist.server");
    const drawn: Record<string, string> = { ...stored };
    await Promise.all(
      wanted
        .filter((scene) => !stored[scene.frameSlot!])
        .map(async (scene) => {
          try {
            const image = await generateImage({
              prompt: creatorFramePrompt({
                scene,
                creatorLook: stock?.look ?? "",
                productName: ctx.product.name,
                setting: brief.creator.setting,
              }),
              size,
              quality: "low",
              meterRoute: "studio.image.storyboard",
              routing: references.length
                ? { referenceAssets: references, editing: true }
                : undefined,
            });
            const saved = await persistAsset({
              workspaceId: input.workspaceId,
              idempotencyKey: `${STORYBOARD_SOURCE}:${input.projectId}:${key}:${scene.frameSlot}`,
              dataUrl: `data:image/png;base64,${image.b64}`,
              assetType: "image",
              filename: `storyboard-${input.projectId.slice(0, 8)}-${scene.number}`,
              metadata: {
                source: STORYBOARD_SOURCE,
                project_id: input.projectId,
                board_key: key,
                slot: scene.frameSlot,
              },
            });
            if (saved.ok && saved.asset.storage_path) {
              const url =
                saved.asset.public_url ??
                (await signStoragePath(
                  supabaseAdmin as unknown as SupabaseClient,
                  saved.asset.storage_path,
                  3600,
                ));
              if (url) drawn[scene.frameSlot!] = url;
            }
          } catch (error) {
            // One frame that couldn't be drawn leaves its card plain; the plan still shows.
            log.warn("ugc.storyboard.frame_failed", {
              projectId: input.projectId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }),
    );
    if (Object.keys(drawn).length === Object.keys(stored).length)
      throw new HttpError(502, "The storyboard frames couldn't be drawn. Try again.");
    return drawn;
  });
  return { key, frames, reused: false };
}
