// resolve.server.ts — the ONE way a generator gets a Style.
//
// Callers pass the request's VERIFIED workspace id (the style id is only
// trusted after it is found inside that workspace). Brand DNA is read here on
// the server, never taken from the browser.
//
//   styleId = "none"          → Brand DNA only
//   styleId = null/undefined  → the workspace's default style (else Brand DNA only)
//   styleId = <uuid>          → that style; if it's gone or archived, the default
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import { resolveStyle, type ResolvedStyle } from "@/lib/brand-kit/resolve";
import { parseStyleSpec } from "@/lib/brand-kit/spec";
import { signPaths, onStylesChanged, type StyleRowDb } from "./store.server";

export type StyleChoice = string | "none" | null | undefined;

export type LoadedStyle = {
  resolved: ResolvedStyle;
  /** Signed URLs of references marked close/exact — for image-to-image. */
  referenceUrls: string[];
  /** Signed URL for the style's kit logo variant, or the Brand DNA logo URL. */
  logoUrl: string | null;
  /** Signed URLs for uploaded font files, by role. */
  fontFiles: { heading?: string; body?: string };
  /** The requested style couldn't be used and the default was used instead. */
  fellBack: boolean;
  /** The stored Brand DNA this was resolved against (server copy, never the browser's). */
  dna: Record<string, unknown> | null;
};

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: LoadedStyle }>();
onStylesChanged((workspaceId) => {
  for (const key of cache.keys()) if (key.startsWith(`${workspaceId}|`)) cache.delete(key);
});

/** Brand DNA saves call this too (see saveBrandDna). */
export function invalidateStyleCache(workspaceId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${workspaceId}|`)) cache.delete(key);
}

const admin = () => supabaseAdmin as unknown as SupabaseClient;
const STYLE_COLS =
  "id, workspace_id, name, description, applies_to, is_default, status, spec, version, cover_asset_id, created_at, updated_at, archived_at";

async function findStyle(
  workspaceId: string,
  choice: StyleChoice,
): Promise<{ row: StyleRowDb | null; fellBack: boolean }> {
  if (choice === "none") return { row: null, fellBack: false };
  if (choice) {
    const { data } = await admin()
      .from("brand_styles")
      .select(STYLE_COLS)
      .eq("workspace_id", workspaceId)
      .eq("id", choice)
      .is("archived_at", null)
      .maybeSingle();
    if (data) return { row: data as StyleRowDb, fellBack: false };
  }
  const { data } = await admin()
    .from("brand_styles")
    .select(STYLE_COLS)
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .maybeSingle();
  return { row: (data as StyleRowDb | null) ?? null, fellBack: !!choice };
}

export async function loadResolvedStyle(
  workspaceId: string,
  choice: StyleChoice,
  opts: { dna?: Record<string, unknown> | null } = {},
): Promise<LoadedStyle> {
  const key = `${workspaceId}|${choice ?? "default"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS && opts.dna === undefined) return hit.value;

  const [{ row, fellBack }, stored] = await Promise.all([
    findStyle(workspaceId, choice).catch(() => ({ row: null, fellBack: !!choice })),
    opts.dna !== undefined
      ? Promise.resolve(null)
      : readBrandDna(admin(), workspaceId).catch(() => null),
  ]);
  const dna = (opts.dna !== undefined ? opts.dna : stored?.dna) ?? null;
  const resolved = resolveStyle(dna as never, row);

  // Files the style needs at generation time.
  const spec = parseStyleSpec(row?.spec);
  const refIds = (spec.references ?? [])
    .filter((r) => r.strength === "close" || r.strength === "exact")
    .map((r) => r.assetId);
  const logoVariant = spec.visual?.logo?.variant;
  const fontIds = [
    spec.visual?.typography?.files?.heading,
    spec.visual?.typography?.files?.body,
  ].filter(Boolean) as string[];
  const assetIds = [...refIds, ...fontIds];
  let referenceUrls: string[] = [];
  let logoUrl: string | null = resolved.logo.dnaUrl;
  const fontFiles: LoadedStyle["fontFiles"] = {};

  if (row && (assetIds.length || logoVariant)) {
    let q = admin()
      .from("brand_kit_assets")
      .select("id, kind, storage_path, frame_paths, created_at")
      .eq("workspace_id", workspaceId);
    q = logoVariant
      ? q.or(
          `id.in.(${assetIds.length ? assetIds.join(",") : "00000000-0000-0000-0000-000000000000"}),kind.eq.${logoVariant}`,
        )
      : q.in("id", assetIds);
    const { data } = await q.order("created_at", { ascending: false }).limit(40);
    const rows = (data ?? []) as Array<{
      id: string;
      kind: string;
      storage_path: string | null;
      frame_paths: string[] | null;
    }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    // A video reference contributes its first frame (image models take stills).
    const refPaths = refIds
      .map((id) => byId.get(id))
      .map((r) => (r?.kind === "inspiration_video" ? r.frame_paths?.[0] : r?.storage_path))
      .filter((p): p is string => !!p)
      .slice(0, 4);
    // Newest logo of that variant wins.
    const logoRow = logoVariant
      ? rows.find((r) => r.kind === logoVariant && r.storage_path)
      : undefined;
    const fontPaths = fontIds
      .map((id) => byId.get(id)?.storage_path)
      .filter((p): p is string => !!p);
    const urls = await signPaths(workspaceId, [
      ...refPaths,
      ...fontPaths,
      ...(logoRow?.storage_path ? [logoRow.storage_path] : []),
    ]);
    referenceUrls = refPaths.map((p) => urls.get(p)).filter((u): u is string => !!u);
    if (logoRow?.storage_path && urls.get(logoRow.storage_path))
      logoUrl = urls.get(logoRow.storage_path)!;
    const files = spec.visual?.typography?.files ?? {};
    for (const role of ["heading", "body"] as const) {
      const id = files[role];
      const path = id ? byId.get(id)?.storage_path : null;
      if (path && urls.get(path)) fontFiles[role] = urls.get(path)!;
    }
  }

  const value: LoadedStyle = {
    resolved,
    referenceUrls,
    logoUrl,
    fontFiles,
    fellBack,
    dna: (dna as Record<string, unknown> | null) ?? null,
  };
  if (opts.dna === undefined) cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Style text for a text generator, or "" for Brand DNA only. An explicit pick
 * always applies; the workspace default only when it lists this format.
 * Never throws — generation without a style is still generation.
 */
export async function styleTextFor(
  workspaceId: string,
  choice: StyleChoice,
  format: string,
): Promise<string> {
  if (choice === "none") return "";
  try {
    const [{ styleBlockFor }, { styleAppliesTo }] = await Promise.all([
      import("@/lib/brand-kit/prompt"),
      import("@/lib/brand-kit/resolve"),
    ]);
    const loaded = await loadResolvedStyle(workspaceId, choice ?? null);
    if (!loaded.resolved.styleId) return "";
    const explicit = !!choice && !loaded.fellBack;
    if (!explicit && !styleAppliesTo(loaded.resolved, format)) return "";
    return styleBlockFor(loaded.resolved, format);
  } catch (error) {
    console.error("[brand-kit] style text failed, using Brand DNA only", error);
    return "";
  }
}
