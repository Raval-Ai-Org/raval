// persist.server.ts — store a generated image/video in the private
// configured storage backend and record it in `assets`. Shared by the
// /api/assets/persist route (browser-generated media) and Studio jobs
// (provider URLs downloaded server-side, no base64 round-trip through the
// browser). Idempotent per (workspace, idempotencyKey).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ResponseTooLargeError, safeFetch } from "@/server/safe-fetch";
import { mergeMeta } from "@/lib/content-lifecycle";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { isAssetMetadataFinalizeEnabled } from "@/lib/feature-flags";
import {
  ASSET_BUCKET,
  isR2StorageEnabled,
  removeAssetObjects,
  r2AssetPath,
  signStoragePath,
  uploadAssetObject,
} from "@/server/assets/storage.server";
import {
  finalizeImageMetadata,
  type ImageMetadataFinding,
} from "@/server/assets/image-metadata.server";

const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
export { ASSET_BUCKET };

export type PersistAssetInput = {
  workspaceId: string;
  idempotencyKey: string;
  bytes?: Buffer;
  dataUrl?: string;
  sourceUrl?: string;
  /** Content items to link. The first becomes assets.content_item_id. */
  contentItemIds?: string[];
  /** Server-owned derived asset relationship; callers must authorize this asset. */
  parentAssetId?: string | null;
  assetType: "image" | "video";
  mimeType?: string;
  filename?: string;
  platform?: string | null;
  provider?: string;
  model?: string | null;
  modelRoute?: string | null;
  promptVersion?: string | null;
  creativeBriefVersion?: string | null;
  brandDnaVersion?: string | null;
  attempt?: number;
  seed?: string | null;
  metadata?: Record<string, unknown>;
};

export type PersistedAsset = {
  id: string;
  workspace_id: string;
  content_item_id: string | null;
  status: string;
  storage_path: string | null;
  public_url: string | null;
  filename: string;
  mime_type: string;
  created_at?: string;
  updated_at?: string;
};

export type PersistResult =
  | { ok: true; asset: PersistedAsset; deduplicated: boolean }
  | { ok: false; status: number; message: string };

function safeName(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "generated-asset"
  );
}

function isAssetsTableUnavailable(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("assets");
}

function errorMessage(error: { message?: string; code?: string } | null) {
  return [error?.message, error?.code].filter(Boolean).join(" ") || "Unknown database error";
}

export async function signAssetPath(storagePath: string | null, ttlSeconds = 3600) {
  if (!storagePath) return null;
  const supabase = supabaseAdmin as unknown as SupabaseClient;
  return signStoragePath(supabase, storagePath, ttlSeconds);
}

function extensionFor(assetType: "image" | "video", mimeType: string) {
  if (assetType === "video") {
    return mimeType.includes("webm") ? "webm" : mimeType.includes("quicktime") ? "mov" : "mp4";
  }
  if (mimeType === "image/gif") return "gif";
  return mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
}

/** Best-effort attribution for image metadata finalization; never blocks persistence. */
async function resolveImageOwnership(supabase: SupabaseClient, workspaceId: string) {
  const { data } = await supabase
    .from("workspaces")
    .select("name, domain")
    .eq("id", workspaceId)
    .maybeSingle();
  const name = String((data as { name?: string } | null)?.name ?? "").trim() || "Mellox AI";
  const domain = String((data as { domain?: string } | null)?.domain ?? "").trim();
  const websiteUrl = domain ? `https://${domain}` : (process.env.APP_URL ?? "");
  return {
    creator: name,
    publisher: name,
    websiteUrl,
    // ASCII only: ExifTool's Windows CLI-argument decoding mangles non-ASCII
    // bytes on some hosts (reproduced during integration testing with both
    // "©" and an em dash) — the underlying brand `name` can still contain
    // non-ASCII characters, that's a pre-existing tool limitation on Windows
    // outside Mellox's control, but text this module itself supplies stays
    // ASCII everywhere the process might run.
    credit: `${name} - generated with Mellox AI`,
  };
}

/**
 * Best-effort EXIF/XMP privacy cleanup + attribution for a generated image.
 * Failure of any kind (missing tooling, provenance detected, verification
 * mismatch) falls open to the original bytes — this must never block an
 * asset from being saved.
 */
async function tryFinalizeImageMetadata(
  supabase: SupabaseClient,
  workspaceId: string,
  assetType: "image" | "video",
  mimeType: string,
  bytes: Buffer,
): Promise<{
  bytes: Buffer;
  report: { applied: boolean; reason?: string; finding?: ImageMetadataFinding } | null;
}> {
  if (assetType !== "image" || !isAssetMetadataFinalizeEnabled(workspaceId)) {
    return { bytes, report: null };
  }
  try {
    const ownership = await resolveImageOwnership(supabase, workspaceId);
    const result = await finalizeImageMetadata(bytes, mimeType, ownership);
    if (result.applied) {
      return { bytes: result.bytes, report: { applied: true, finding: result.finding } };
    }
    return { bytes, report: { applied: false, reason: result.reason, finding: result.finding } };
  } catch (error) {
    console.warn("[assets] image metadata finalization failed", errorMessage(error as Error));
    return { bytes, report: { applied: false, reason: "unexpected-error" } };
  }
}

export async function persistAsset(input: PersistAssetInput): Promise<PersistResult> {
  const { workspaceId, idempotencyKey, assetType } = input;
  if (!idempotencyKey || (!input.bytes && !input.dataUrl && !input.sourceUrl)) {
    return { ok: false, status: 400, message: "idempotencyKey and asset data are required" };
  }

  // Membership/role is checked by the caller with the user's session. Asset and
  // Storage writes use the service role so valid members are not blocked by
  // Storage RLS differences between environments. Untyped: `assets` is missing
  // from the generated Database types.
  const supabase = supabaseAdmin as unknown as SupabaseClient;

  // Deduplicate before downloading anything.
  const { data: existing, error: existingError } = await supabase
    .from("assets")
    .select(
      "id, workspace_id, content_item_id, status, public_url, storage_path, filename, mime_type, deleted_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (isAssetsTableUnavailable(existingError)) {
    return {
      ok: false,
      status: 503,
      message:
        "Persistent asset storage is not configured. Apply the latest Supabase migration and retry.",
    };
  }
  if (existingError) {
    return { ok: false, status: 503, message: "Could not check persistent asset storage" };
  }
  if (existing?.deleted_at) {
    return { ok: false, status: 410, message: "This asset has been deleted" };
  }
  const leaseExpired =
    existing?.updated_at && Date.now() - Date.parse(existing.updated_at) > 15 * 60_000;
  if (existing?.status === "persisting" && !leaseExpired) {
    return {
      ok: false,
      status: 409,
      message: "This asset is already being stored. Retry shortly.",
    };
  }
  if (existing?.status === "ready") {
    if (existing.storage_path && !isWorkspaceStoragePath(existing.storage_path, workspaceId)) {
      return { ok: false, status: 403, message: "Stored media is outside this workspace" };
    }
    const url = (await signAssetPath(existing.storage_path)) ?? existing.public_url ?? null;
    if (url) return { ok: true, asset: { ...existing, public_url: url }, deduplicated: true };
  }

  let mimeType = (input.mimeType ?? "").toLowerCase();
  let bytes: Buffer;
  if (input.bytes) {
    bytes = input.bytes;
  } else if (input.dataUrl) {
    const match = input.dataUrl.match(DATA_URL_RE);
    if (!match) return { ok: false, status: 400, message: "Generated asset data is invalid" };
    mimeType = match[1].toLowerCase();
    bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  } else {
    try {
      // safeFetch refuses private targets and aborts past the size cap while streaming.
      const response = await safeFetch(input.sourceUrl!, {
        timeoutMs: 60_000,
        maxBytes: MAX_ASSET_BYTES,
        onOverflow: "error",
      });
      if (!response.ok) {
        return { ok: false, status: 502, message: "Generated asset could not be downloaded" };
      }
      mimeType =
        mimeType ||
        response.headers.get("content-type")?.split(";")[0] ||
        (assetType === "video" ? "video/mp4" : "image/png");
      bytes = Buffer.from(response.bytes);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        return { ok: false, status: 413, message: "Generated asset is too large" };
      }
      return { ok: false, status: 502, message: "Generated asset could not be downloaded" };
    }
  }
  if (!bytes.length || bytes.length > MAX_ASSET_BYTES) {
    return { ok: false, status: 413, message: "Generated asset is too large" };
  }

  const supportedTypes =
    assetType === "image"
      ? ["image/png", "image/jpeg", "image/webp", "image/gif"]
      : ["video/mp4", "video/webm", "video/quicktime"];
  if (!supportedTypes.includes(mimeType)) {
    return { ok: false, status: 415, message: "Unsupported generated media type" };
  }
  let useR2: boolean;
  try {
    useR2 = isR2StorageEnabled();
    if (!useR2 && process.env.NODE_ENV === "production") throw new Error("R2 is required");
  } catch {
    return {
      ok: false,
      status: 503,
      message: "Generated media storage is not configured correctly",
    };
  }

  const finalized = await tryFinalizeImageMetadata(
    supabase,
    workspaceId,
    assetType,
    mimeType,
    bytes,
  );
  bytes = finalized.bytes;

  // Only link content items that really belong to this workspace.
  let linkIds: string[] = [];
  if (input.contentItemIds?.length) {
    const { data: rows } = await supabase
      .from("content_items")
      .select("id")
      .in("id", input.contentItemIds)
      .eq("workspace_id", workspaceId);
    const valid = new Set((rows ?? []).map((r: { id: string }) => r.id));
    linkIds = input.contentItemIds.filter((id) => valid.has(id));
  }
  const primaryContentId = linkIds[0] ?? null;
  if (input.parentAssetId) {
    const { data: parent } = await supabase
      .from("assets")
      .select("id")
      .eq("id", input.parentAssetId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!parent) return { ok: false, status: 403, message: "Parent asset is unavailable" };
  }

  let assetId = existing?.id as string | undefined;
  if (!assetId) {
    assetId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("assets").insert({
      id: assetId,
      workspace_id: workspaceId,
      content_item_id: primaryContentId,
      parent_asset_id: input.parentAssetId ?? null,
      generation_id: idempotencyKey,
      idempotency_key: idempotencyKey,
      asset_type: assetType,
      status: "persisting",
      filename: safeName(input.filename ?? `mellox-${idempotencyKey.slice(0, 12)}`),
      mime_type: mimeType,
      platform: input.platform ?? null,
      provider: input.provider ?? "kie",
      model: input.model ?? null,
      model_route: input.modelRoute ?? null,
      prompt_version: input.promptVersion ?? null,
      creative_brief_version: input.creativeBriefVersion ?? null,
      brand_dna_version: input.brandDnaVersion ?? null,
      attempt: input.attempt ?? 1,
      seed: input.seed ?? null,
      metadata: finalized.report
        ? { ...(input.metadata ?? {}), image_metadata_finalization: finalized.report }
        : (input.metadata ?? {}),
    });
    if (insertError && insertError.code !== "23505") {
      return {
        ok: false,
        status: 500,
        message: `Could not create persistent asset record: ${errorMessage(insertError)}`,
      };
    }
    if (insertError) {
      const { data: raced } = await supabase
        .from("assets")
        .select(
          "id, workspace_id, content_item_id, status, public_url, storage_path, filename, mime_type, deleted_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", idempotencyKey)
        .single();
      assetId = raced?.id;
      if (raced?.deleted_at) {
        return { ok: false, status: 410, message: "This asset has been deleted" };
      }
      if (raced?.status === "ready") {
        if (raced.storage_path && !isWorkspaceStoragePath(raced.storage_path, workspaceId)) {
          return { ok: false, status: 403, message: "Stored media is outside this workspace" };
        }
        const url = (await signAssetPath(raced.storage_path)) ?? raced.public_url ?? null;
        if (url) return { ok: true, asset: { ...raced, public_url: url }, deduplicated: true };
      }
      return {
        ok: false,
        status: 409,
        message: "This asset is already being stored. Retry shortly.",
      };
    }
  } else {
    let claim = supabase
      .from("assets")
      .update({ status: "persisting", updated_at: new Date().toISOString() })
      .eq("id", assetId)
      .eq("status", existing!.status)
      .is("deleted_at", null);
    if (existing!.updated_at) claim = claim.eq("updated_at", existing!.updated_at);
    const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
    if (claimError || !claimed) {
      return {
        ok: false,
        status: 409,
        message: "This asset is already being stored. Retry shortly.",
      };
    }
  }
  if (!assetId)
    return { ok: false, status: 500, message: "Could not resolve persistent asset record" };

  const filename = `original.${extensionFor(assetType, mimeType)}`;
  const path = useR2
    ? r2AssetPath(workspaceId, assetId, filename)
    : `workspace/${workspaceId}/assets/${assetId}/${filename}`;
  const markFailed = async (reason: string | undefined) => {
    await supabase
      .from("assets")
      .update({ status: "persistence_failed", metadata: { persistence_error: reason } })
      .eq("id", assetId);
  };
  const cleanupFailed = async (reason: string) => {
    try {
      await removeAssetObjects([path]);
    } catch {
      console.warn("[assets] failed upload cleanup could not be completed", assetId);
    }
    await markFailed(reason);
  };

  try {
    if (path.includes("/assets/r2/")) {
      await uploadAssetObject(path, bytes, mimeType);
    } else {
      const { error: uploadError } = await supabase.storage
        .from(ASSET_BUCKET)
        .upload(path, bytes, { contentType: mimeType, upsert: true });
      if (uploadError) throw uploadError;
    }
  } catch (uploadError) {
    const message = uploadError instanceof Error ? uploadError.message : "Unknown storage error";
    await markFailed(message);
    return {
      ok: false,
      status: 502,
      message: `Generated ${assetType} could not be stored: ${message}`,
    };
  }

  let signedUrl: string | null;
  try {
    signedUrl = await signAssetPath(path);
  } catch (error) {
    await cleanupFailed(error instanceof Error ? error.message : "signed URL unavailable");
    return { ok: false, status: 502, message: "Generated asset could not receive a signed URL" };
  }
  if (!signedUrl) {
    await cleanupFailed("signed URL unavailable");
    return { ok: false, status: 502, message: "Generated asset could not receive a signed URL" };
  }

  const { data: ready, error: readyError } = await supabase
    .from("assets")
    .update({
      status: "ready",
      storage_path: path,
      public_url: null,
      content_item_id: primaryContentId,
    })
    .eq("id", assetId)
    .select(
      "id, workspace_id, content_item_id, status, storage_path, public_url, filename, mime_type, created_at, updated_at",
    )
    .single();
  if (readyError || !ready) {
    await cleanupFailed(errorMessage(readyError));
    return {
      ok: false,
      status: 500,
      message: `Asset storage succeeded but metadata could not be finalized: ${errorMessage(readyError)}`,
    };
  }

  if (linkIds.length)
    await linkAssetToContent(workspaceId, linkIds, { id: assetId, path, assetType });

  return { ok: true, asset: { ...ready, public_url: signedUrl }, deduplicated: false };
}

/**
 * Point content items at a stored asset. The durable Storage path lives in
 * meta; media_url stays null because a signed URL is presentation, not identity.
 */
export async function linkAssetToContent(
  workspaceId: string,
  contentItemIds: string[],
  asset: { id: string; path: string; assetType: "image" | "video" },
) {
  const supabase = supabaseAdmin as unknown as SupabaseClient;
  const { data: rows } = await supabase
    .from("content_items")
    .select("id, meta")
    .in("id", contentItemIds)
    .eq("workspace_id", workspaceId);
  for (const row of (rows ?? []) as Array<{ id: string; meta: unknown }>) {
    const { error } = await supabase
      .from("content_items")
      .update({
        media_url: null,
        meta: mergeMeta(row.meta, {
          asset_id: asset.id,
          asset_storage_path: asset.path,
          asset_status: "ready",
          media_type: asset.assetType,
        }),
      })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
    if (error) console.warn("[assets] content link update failed", row.id, errorMessage(error));
  }
}
