// store.server.ts — Brand Kit rows: styles and kit assets.
//
// Reads take the caller's RLS-bound client, so a member only ever sees their
// own workspace. Writes use the service role and are only called after the RPC
// layer checked the workspace role (src/server/fns/brand-kit.ts). Every write
// is scoped by workspace_id as well as id, so a guessed id from another
// workspace matches nothing.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import {
  MAX_STYLES_PER_WORKSPACE,
  type BrandKitDnaSummary,
  type BrandKitOverview,
  type BrandStyleView,
  type KitAssetView,
} from "@/lib/brand-kit/contracts";
import type { ReferenceAnalysis } from "@/lib/brand-kit/merge";
import {
  STYLE_FORMATS,
  emptySpec,
  parseStyleSpec,
  type KitAssetKind,
  type StyleFormat,
  type StyleSpec,
} from "@/lib/brand-kit/spec";

export const KIT_BUCKET = "generated-assets";
const SIGN_TTL = 3600;
/** An analysis still "running" after this long is presumed dead. */
export const STALE_ANALYSIS_MS = 10 * 60 * 1000;

const admin = () => supabaseAdmin as unknown as SupabaseClient;

export type StyleRowDb = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  applies_to: string[] | null;
  is_default: boolean;
  status: string;
  spec: unknown;
  version: number;
  cover_asset_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type AssetRowDb = {
  id: string;
  workspace_id: string;
  style_id: string | null;
  kind: string;
  label: string | null;
  tags: string[] | null;
  storage_path: string | null;
  frame_paths: string[] | null;
  text_content: string | null;
  source_url: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  analysis: unknown;
  analysis_status: string;
  analysis_error: string | null;
  analysis_started_at: string | null;
  created_at: string;
};

const STYLE_COLS =
  "id, workspace_id, name, description, applies_to, is_default, status, spec, version, cover_asset_id, created_at, updated_at, archived_at";
const ASSET_COLS =
  "id, workspace_id, style_id, kind, label, tags, storage_path, frame_paths, text_content, source_url, mime, bytes, width, height, analysis, analysis_status, analysis_error, analysis_started_at, created_at";

export class BrandKitError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
    this.name = "BrandKitError";
  }
}

function formats(values: string[] | null | undefined): StyleFormat[] {
  return (values ?? []).filter((v): v is StyleFormat =>
    (STYLE_FORMATS as readonly string[]).includes(v),
  );
}

/** Sign many workspace paths at once; paths outside the workspace are refused. */
export async function signPaths(
  workspaceId: string,
  paths: string[],
): Promise<Map<string, string>> {
  const safe = [...new Set(paths.filter((p) => isWorkspaceStoragePath(p, workspaceId)))];
  const out = new Map<string, string>();
  if (!safe.length) return out;
  const { data } = await admin().storage.from(KIT_BUCKET).createSignedUrls(safe, SIGN_TTL);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}

export function toAssetView(row: AssetRowDb, urls: Map<string, string>): KitAssetView {
  const status = row.analysis_status as KitAssetView["analysisStatus"];
  const started = row.analysis_started_at ? Date.parse(row.analysis_started_at) : 0;
  return {
    id: row.id,
    styleId: row.style_id,
    kind: row.kind as KitAssetKind,
    label: row.label,
    tags: row.tags ?? [],
    url: row.storage_path ? (urls.get(row.storage_path) ?? null) : null,
    frameUrls: (row.frame_paths ?? []).map((p) => urls.get(p)).filter((u): u is string => !!u),
    textContent: row.text_content ? row.text_content.slice(0, 4000) : null,
    sourceUrl: row.source_url,
    mime: row.mime,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    analysisStatus: status,
    analysisError: row.analysis_error,
    analysis: (row.analysis as ReferenceAnalysis | null) ?? null,
    stale: status === "running" && !!started && Date.now() - started > STALE_ANALYSIS_MS,
    createdAt: row.created_at,
  };
}

export function toStyleView(row: StyleRowDb, coverUrl: string | null): BrandStyleView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    appliesTo: formats(row.applies_to),
    isDefault: row.is_default,
    status: row.status as BrandStyleView["status"],
    spec: parseStyleSpec(row.spec),
    version: row.version,
    coverUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: !!row.archived_at,
  };
}

export function dnaSummary(dna: Record<string, unknown> | null | undefined): BrandKitDnaSummary {
  const d = dna ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const colors = Array.isArray(d.colors)
    ? (d.colors as Array<{ name?: string; hex?: string }>)
        .filter((c) => typeof c?.hex === "string")
        .map((c) => ({ name: c.name, hex: c.hex as string }))
        .slice(0, 8)
    : [];
  const fonts = Array.isArray(d.fonts)
    ? (d.fonts as unknown[]).filter((f): f is string => typeof f === "string").slice(0, 3)
    : [];
  return {
    hasDna: Object.keys(d).length > 0,
    brandName: str(d.brandName),
    voice: str(d.voice),
    colors,
    fonts,
    logoUrl: str(d.logoUrl),
  };
}

export async function loadOverview(
  db: SupabaseClient,
  workspaceId: string,
  opts: { canEdit: boolean; includeArchived?: boolean },
): Promise<BrandKitOverview> {
  let styleQuery = db
    .from("brand_styles")
    .select(STYLE_COLS)
    .eq("workspace_id", workspaceId)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(MAX_STYLES_PER_WORKSPACE + 20);
  if (!opts.includeArchived) styleQuery = styleQuery.is("archived_at", null);
  const [stylesRes, assetsRes, stored] = await Promise.all([
    styleQuery,
    db
      .from("brand_kit_assets")
      .select(ASSET_COLS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(400),
    readBrandDna(db, workspaceId),
  ]);
  if (stylesRes.error) throw new Error(stylesRes.error.message);
  if (assetsRes.error) throw new Error(assetsRes.error.message);
  const styles = (stylesRes.data ?? []) as StyleRowDb[];
  const assets = (assetsRes.data ?? []) as AssetRowDb[];
  const paths = assets
    .flatMap((a) => [a.storage_path, ...(a.frame_paths ?? [])])
    .filter(Boolean) as string[];
  const urls = await signPaths(workspaceId, paths);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const cover = (s: StyleRowDb) => {
    const asset = s.cover_asset_id ? byId.get(s.cover_asset_id) : undefined;
    const path = asset?.storage_path ?? asset?.frame_paths?.[0];
    return path ? (urls.get(path) ?? null) : null;
  };
  return {
    styles: styles.map((s) => toStyleView(s, cover(s))),
    assets: assets.map((a) => toAssetView(a, urls)),
    defaultStyleId: styles.find((s) => s.is_default)?.id ?? null,
    dna: dnaSummary(stored?.dna),
    canEdit: opts.canEdit,
  };
}

export async function getStyleRow(workspaceId: string, styleId: string): Promise<StyleRowDb> {
  const { data, error } = await admin()
    .from("brand_styles")
    .select(STYLE_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", styleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new BrandKitError("That style no longer exists.", 404);
  return data as StyleRowDb;
}

export async function getAssetRows(workspaceId: string, ids: string[]): Promise<AssetRowDb[]> {
  if (!ids.length) return [];
  const { data, error } = await admin()
    .from("brand_kit_assets")
    .select(ASSET_COLS)
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetRowDb[];
}

export async function styleView(workspaceId: string, styleId: string): Promise<BrandStyleView> {
  const row = await getStyleRow(workspaceId, styleId);
  let coverUrl: string | null = null;
  if (row.cover_asset_id) {
    const [asset] = await getAssetRows(workspaceId, [row.cover_asset_id]);
    const path = asset?.storage_path ?? asset?.frame_paths?.[0];
    if (path) coverUrl = (await signPaths(workspaceId, [path])).get(path) ?? null;
  }
  return toStyleView(row, coverUrl);
}

async function countStyles(workspaceId: string): Promise<number> {
  const { count } = await admin()
    .from("brand_styles")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  return count ?? 0;
}

export async function createStyle(args: {
  workspaceId: string;
  userId: string;
  name: string;
  description?: string | null;
  appliesTo?: StyleFormat[];
  spec?: StyleSpec;
  makeDefault?: boolean;
  status?: BrandStyleView["status"];
}): Promise<BrandStyleView> {
  if ((await countStyles(args.workspaceId)) >= MAX_STYLES_PER_WORKSPACE) {
    throw new BrandKitError(
      `A workspace can keep up to ${MAX_STYLES_PER_WORKSPACE} styles. Archive one first.`,
    );
  }
  const { data, error } = await admin()
    .from("brand_styles")
    .insert({
      workspace_id: args.workspaceId,
      name: args.name.trim().slice(0, 80) || "Untitled style",
      description: args.description?.trim().slice(0, 400) || null,
      applies_to: args.appliesTo ?? [],
      spec: parseStyleSpec(args.spec ?? emptySpec()),
      status: args.status ?? "draft",
      created_by: args.userId,
      updated_by: args.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (args.makeDefault) await setDefaultStyle(args.workspaceId, data.id);
  return styleView(args.workspaceId, data.id);
}

export async function updateStyle(args: {
  workspaceId: string;
  userId: string;
  styleId: string;
  /** The version the editor started from; a mismatch is a conflict. */
  expectedVersion?: number;
  patch: {
    name?: string;
    description?: string | null;
    appliesTo?: StyleFormat[];
    spec?: StyleSpec;
    status?: BrandStyleView["status"];
    coverAssetId?: string | null;
  };
}): Promise<BrandStyleView> {
  const current = await getStyleRow(args.workspaceId, args.styleId);
  if (args.expectedVersion != null && current.version !== args.expectedVersion) {
    throw new BrandKitError("Someone else changed this style. Reload to see the latest.", 409);
  }
  if (args.patch.coverAssetId) {
    const [asset] = await getAssetRows(args.workspaceId, [args.patch.coverAssetId]);
    if (!asset) throw new BrandKitError("That image isn't in this workspace's kit.");
  }
  const update: Record<string, unknown> = {
    version: current.version + 1,
    updated_by: args.userId,
  };
  if (args.patch.name !== undefined)
    update.name = args.patch.name.trim().slice(0, 80) || current.name;
  if (args.patch.description !== undefined)
    update.description = args.patch.description?.trim().slice(0, 400) || null;
  if (args.patch.appliesTo !== undefined) update.applies_to = args.patch.appliesTo;
  if (args.patch.spec !== undefined) update.spec = parseStyleSpec(args.patch.spec);
  if (args.patch.status !== undefined) update.status = args.patch.status;
  if (args.patch.coverAssetId !== undefined) update.cover_asset_id = args.patch.coverAssetId;
  // Compare-and-set on version so two editors can't silently overwrite each other.
  const { data, error } = await admin()
    .from("brand_styles")
    .update(update)
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.styleId)
    .eq("version", current.version)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length)
    throw new BrandKitError("Someone else changed this style. Reload to see the latest.", 409);
  invalidateResolvedStyles(args.workspaceId);
  return styleView(args.workspaceId, args.styleId);
}

export async function setDefaultStyle(workspaceId: string, styleId: string | null): Promise<void> {
  const { error } = await admin().rpc("set_default_brand_style", {
    p_workspace_id: workspaceId,
    p_style_id: styleId,
  } as never);
  if (error) {
    if (/not found/i.test(error.message))
      throw new BrandKitError("That style no longer exists.", 404);
    throw new Error(error.message);
  }
  invalidateResolvedStyles(workspaceId);
}

export async function archiveStyle(
  workspaceId: string,
  styleId: string,
  archived: boolean,
): Promise<void> {
  const row = await getStyleRow(workspaceId, styleId);
  const { error } = await admin()
    .from("brand_styles")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      is_default: archived ? false : row.is_default,
      version: row.version + 1,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", styleId);
  if (error) throw new Error(error.message);
  invalidateResolvedStyles(workspaceId);
}

export async function duplicateStyle(
  workspaceId: string,
  userId: string,
  styleId: string,
): Promise<BrandStyleView> {
  const row = await getStyleRow(workspaceId, styleId);
  return createStyle({
    workspaceId,
    userId,
    name: `${row.name} copy`.slice(0, 80),
    description: row.description,
    appliesTo: formats(row.applies_to),
    spec: parseStyleSpec(row.spec),
    status: row.status === "analyzing" ? "ready" : (row.status as BrandStyleView["status"]),
  });
}

/**
 * First visit with Brand DNA but no styles: create one "Brand DNA" style that
 * inherits everything, and make it the default — so Studio's picker has
 * something real to show. Idempotent: does nothing once any style exists
 * (archived ones included — the person has already been here).
 */
export async function ensureSeedStyle(workspaceId: string, userId: string): Promise<boolean> {
  const { count } = await admin()
    .from("brand_styles")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (count && count > 0) return false;
  const stored = await readBrandDna(admin(), workspaceId);
  if (!stored || !Object.keys(stored.dna).length) return false;
  const summary = dnaSummary(stored.dna);
  try {
    await createStyle({
      workspaceId,
      userId,
      name: summary.brandName ? `${summary.brandName} default` : "Brand default",
      description: "Follows your Brand DNA. Change anything here and it applies to new content.",
      spec: emptySpec(),
      makeDefault: true,
      status: "ready",
    });
    return true;
  } catch (e) {
    // Two tabs racing: the other one's default wins; the unique index refuses ours.
    console.warn("[brand-kit] seed style skipped", (e as Error).message);
    return false;
  }
}

export async function updateAsset(args: {
  workspaceId: string;
  assetId: string;
  patch: { label?: string | null; tags?: string[]; styleId?: string | null };
}): Promise<void> {
  if (args.patch.styleId) await getStyleRow(args.workspaceId, args.patch.styleId);
  const update: Record<string, unknown> = {};
  if (args.patch.label !== undefined) update.label = args.patch.label?.trim().slice(0, 120) || null;
  if (args.patch.tags !== undefined)
    update.tags = args.patch.tags
      .map((t) => t.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 12);
  if (args.patch.styleId !== undefined) update.style_id = args.patch.styleId;
  const { data, error } = await admin()
    .from("brand_kit_assets")
    .update(update)
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.assetId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new BrandKitError("That file no longer exists.", 404);
  invalidateResolvedStyles(args.workspaceId);
}

export async function deleteAsset(workspaceId: string, assetId: string): Promise<void> {
  const [row] = await getAssetRows(workspaceId, [assetId]);
  if (!row) return;
  const { error } = await admin()
    .from("brand_kit_assets")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", assetId);
  if (error) throw new Error(error.message);
  const paths = [row.storage_path, ...(row.frame_paths ?? [])].filter(
    (p): p is string => !!p && isWorkspaceStoragePath(p, workspaceId),
  );
  if (paths.length)
    await admin()
      .storage.from(KIT_BUCKET)
      .remove(paths)
      .catch(() => null);
  // Drop dangling references from styles that pointed at it.
  const { data: styles } = await admin()
    .from("brand_styles")
    .select("id, spec, version, cover_asset_id")
    .eq("workspace_id", workspaceId);
  for (const s of (styles ?? []) as Array<{
    id: string;
    spec: unknown;
    version: number;
    cover_asset_id: string | null;
  }>) {
    const spec = parseStyleSpec(s.spec);
    const refs = spec.references?.filter((r) => r.assetId !== assetId);
    const files = spec.visual?.typography?.files;
    const fontHit = files && (files.heading === assetId || files.body === assetId);
    if (refs?.length === spec.references?.length && s.cover_asset_id !== assetId && !fontHit)
      continue;
    spec.references = refs;
    if (fontHit && spec.visual?.typography?.files) {
      const f = { ...spec.visual.typography.files };
      if (f.heading === assetId) delete f.heading;
      if (f.body === assetId) delete f.body;
      spec.visual.typography.files = f;
    }
    await admin()
      .from("brand_styles")
      .update({
        spec,
        version: s.version + 1,
        cover_asset_id: s.cover_asset_id === assetId ? null : s.cover_asset_id,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", s.id);
  }
  invalidateResolvedStyles(workspaceId);
}

// ── Resolved-style cache hook (filled by resolve.server.ts) ────────────────
const invalidators = new Set<(workspaceId: string) => void>();
export function onStylesChanged(fn: (workspaceId: string) => void) {
  invalidators.add(fn);
}
export function invalidateResolvedStyles(workspaceId: string) {
  for (const fn of invalidators) fn(workspaceId);
}
