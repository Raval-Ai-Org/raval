// persist.server.ts — store a generated image/video in the private
// `generated-assets` bucket and record it in `assets`. Shared by the
// /api/assets/persist route (browser-generated media) and Studio jobs
// (provider URLs downloaded server-side, no base64 round-trip through the
// browser). Idempotent per (workspace, idempotencyKey).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ResponseTooLargeError, safeFetch } from "@/server/safe-fetch";
import { mergeMeta } from "@/lib/content-lifecycle";

const DATA_URL_RE = /^data:([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
export const ASSET_BUCKET = "generated-assets";

export type PersistAssetInput = {
  workspaceId: string;
  idempotencyKey: string;
  dataUrl?: string;
  sourceUrl?: string;
  /** Content items to link. The first becomes assets.content_item_id. */
  contentItemIds?: string[];
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
  const { data, error } = await supabase.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  return error ? null : data.signedUrl;
}

function extensionFor(assetType: "image" | "video", mimeType: string) {
  if (assetType === "video") {
    return mimeType.includes("webm") ? "webm" : mimeType.includes("quicktime") ? "mov" : "mp4";
  }
  return mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
}

export async function persistAsset(input: PersistAssetInput): Promise<PersistResult> {
  const { workspaceId, idempotencyKey, assetType } = input;
  if (!idempotencyKey || (!input.dataUrl && !input.sourceUrl)) {
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
      "id, workspace_id, content_item_id, status, public_url, storage_path, filename, mime_type",
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
  if (existing?.status === "ready") {
    const url = (await signAssetPath(existing.storage_path)) ?? existing.public_url ?? null;
    if (url) return { ok: true, asset: { ...existing, public_url: url }, deduplicated: true };
  }

  let mimeType = (input.mimeType ?? "").toLowerCase();
  let bytes: Buffer;
  if (input.dataUrl) {
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

  let assetId = existing?.id as string | undefined;
  if (!assetId) {
    assetId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("assets").insert({
      id: assetId,
      workspace_id: workspaceId,
      content_item_id: primaryContentId,
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
      metadata: input.metadata ?? {},
    });
    if (insertError && !String(insertError.message).toLowerCase().includes("duplicate")) {
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
          "id, workspace_id, content_item_id, status, public_url, storage_path, filename, mime_type",
        )
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", idempotencyKey)
        .single();
      assetId = raced?.id;
      if (raced?.status === "ready") {
        const url = (await signAssetPath(raced.storage_path)) ?? raced.public_url ?? null;
        if (url) return { ok: true, asset: { ...raced, public_url: url }, deduplicated: true };
      }
    }
  } else {
    await supabase.from("assets").update({ status: "persisting" }).eq("id", assetId);
  }
  if (!assetId)
    return { ok: false, status: 500, message: "Could not resolve persistent asset record" };

  const path = `workspace/${workspaceId}/assets/${assetId}/original.${extensionFor(assetType, mimeType)}`;
  const markFailed = async (reason: string | undefined) => {
    await supabase
      .from("assets")
      .update({ status: "persistence_failed", metadata: { persistence_error: reason } })
      .eq("id", assetId);
  };

  const { error: uploadError } = await supabase.storage
    .from(ASSET_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: true });
  if (uploadError) {
    await markFailed(uploadError.message);
    return {
      ok: false,
      status: 502,
      message: `Generated ${assetType} could not be stored: ${errorMessage(uploadError)}`,
    };
  }

  const signedUrl = await signAssetPath(path);
  if (!signedUrl) {
    await supabase.storage.from(ASSET_BUCKET).remove([path]);
    await markFailed("signed URL unavailable");
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
    await supabase.storage.from(ASSET_BUCKET).remove([path]);
    await markFailed(errorMessage(readyError));
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
