import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { ResponseTooLargeError, safeFetch } from "@/server/safe-fetch";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATA_URL_RE = /^data:([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

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

async function signedAssetUrl(supabase: SupabaseClient, storagePath: string | null) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage
    .from("generated-assets")
    .createSignedUrl(storagePath, 3600);
  return error ? null : data.signedUrl;
}

const MAX_ASSET_BYTES = 50 * 1024 * 1024;

// Fields are validated individually below; the schema only guarantees an object.
const BodySchema = z.record(z.unknown());

export const POST = defineRoute({
  name: "assets/persist",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId }) => {
    const contentItemId = typeof body.contentItemId === "string" ? body.contentItemId : null;
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
    const assetType = body.assetType === "video" ? "video" : "image";
    if (
      (contentItemId && !UUID_RE.test(contentItemId)) ||
      !idempotencyKey ||
      (!dataUrl && !sourceUrl)
    ) {
      return jsonError(400, "workspaceId, idempotencyKey, and dataUrl are required");
    }

    let mimeType = typeof body.mimeType === "string" ? body.mimeType.toLowerCase() : "";
    let bytes: Buffer;
    if (dataUrl) {
      const match = dataUrl.match(DATA_URL_RE);
      if (!match) return jsonError(400, "Generated asset data is invalid");
      mimeType = match[1].toLowerCase();
      bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    } else {
      try {
        // safeFetch refuses private targets and aborts past the size cap while
        // streaming, instead of buffering an arbitrarily large body first.
        const response = await safeFetch(sourceUrl, {
          timeoutMs: 30_000,
          maxBytes: MAX_ASSET_BYTES,
          onOverflow: "error",
        });
        if (!response.ok) return jsonError(502, "Generated asset could not be downloaded");
        mimeType =
          mimeType ||
          response.headers.get("content-type")?.split(";")[0] ||
          "application/octet-stream";
        bytes = Buffer.from(response.bytes);
      } catch (error) {
        if (error instanceof ResponseTooLargeError) {
          return jsonError(413, "Generated asset is too large");
        }
        return jsonError(502, "Generated asset could not be downloaded");
      }
    }
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES)
      return jsonError(413, "Generated asset is too large");

    // Membership is checked by the kernel with the user's session. The asset
    // and Storage writes use the service role so valid members are not blocked
    // by Storage RLS policy differences between environments. Untyped because
    // `assets` is missing from the generated Database types.
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    // A canvas or approval id is not necessarily a content_items id. Asset
    // persistence must never depend on that optional relationship being valid.
    let linkedContentItemId: string | null = null;
    if (contentItemId) {
      const { data: contentItem } = await supabase
        .from("content_items")
        .select("id")
        .eq("id", contentItemId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      linkedContentItemId = contentItem?.id ?? null;
    }

    const { data: existing, error: existingError } = await supabase
      .from("assets")
      .select("id, status, public_url, storage_path, filename")
      .eq("workspace_id", workspaceId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (isAssetsTableUnavailable(existingError)) {
      return jsonError(
        503,
        "Persistent asset storage is not configured. Apply the latest Supabase migration and retry.",
      );
    }
    if (existing?.status === "ready") {
      const url =
        (await signedAssetUrl(supabase, existing.storage_path)) ?? existing.public_url ?? null;
      if (url)
        return Response.json({ asset: { ...existing, public_url: url }, deduplicated: true });
    }

    let assetId = existing?.id as string | undefined;
    if (!assetId) {
      assetId = crypto.randomUUID();
      const { error: insertError } = await supabase.from("assets").insert({
        id: assetId,
        workspace_id: workspaceId,
        content_item_id: linkedContentItemId,
        generation_id: idempotencyKey,
        idempotency_key: idempotencyKey,
        asset_type: assetType,
        status: "persisting",
        filename: safeName(
          typeof body.filename === "string"
            ? body.filename
            : `mellox-${idempotencyKey.slice(0, 12)}`,
        ),
        mime_type: mimeType,
        platform: typeof body.platform === "string" ? body.platform : null,
        provider: typeof body.provider === "string" ? body.provider : "kie",
        model: typeof body.model === "string" ? body.model : null,
        model_route: typeof body.modelRoute === "string" ? body.modelRoute : null,
        prompt_version: typeof body.promptVersion === "string" ? body.promptVersion : null,
        creative_brief_version:
          typeof body.creativeBriefVersion === "string" ? body.creativeBriefVersion : null,
        brand_dna_version: typeof body.brandDnaVersion === "string" ? body.brandDnaVersion : null,
        attempt: typeof body.attempt === "number" ? body.attempt : 1,
        seed: typeof body.seed === "string" ? body.seed : null,
        metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
      });
      if (insertError && !String(insertError.message).toLowerCase().includes("duplicate")) {
        return jsonError(
          500,
          `Could not create persistent asset record: ${errorMessage(insertError)}`,
        );
      }
      if (insertError) {
        const { data: raced } = await supabase
          .from("assets")
          .select("id, status, public_url, storage_path, filename")
          .eq("workspace_id", workspaceId)
          .eq("idempotency_key", idempotencyKey)
          .single();
        assetId = raced?.id;
        if (raced?.status === "ready") {
          const url =
            (await signedAssetUrl(supabase, raced.storage_path)) ?? raced.public_url ?? null;
          if (url)
            return Response.json({ asset: { ...raced, public_url: url }, deduplicated: true });
        }
      }
    } else {
      await supabase.from("assets").update({ status: "persisting" }).eq("id", assetId);
    }

    if (!assetId) return jsonError(500, "Could not resolve persistent asset record");
    const extension =
      assetType === "video"
        ? mimeType.includes("webm")
          ? "webm"
          : mimeType.includes("quicktime")
            ? "mov"
            : "mp4"
        : mimeType.includes("png")
          ? "png"
          : mimeType.includes("webp")
            ? "webp"
            : "jpg";
    const path = `workspace/${workspaceId}/assets/${assetId}/original.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("generated-assets")
      .upload(path, bytes, { contentType: mimeType, upsert: true });
    if (uploadError) {
      await supabase
        .from("assets")
        .update({
          status: "persistence_failed",
          metadata: { persistence_error: uploadError.message },
        })
        .eq("id", assetId);
      return jsonError(
        502,
        `Generated ${assetType} could not be stored: ${errorMessage(uploadError)}`,
      );
    }

    const { data: signedFile, error: signedUrlError } = await supabase.storage
      .from("generated-assets")
      .createSignedUrl(path, 3600);
    if (signedUrlError || !signedFile?.signedUrl) {
      await supabase.storage.from("generated-assets").remove([path]);
      await supabase
        .from("assets")
        .update({
          status: "persistence_failed",
          metadata: { persistence_error: signedUrlError?.message },
        })
        .eq("id", assetId);
      return jsonError(502, "Generated asset could not receive a signed URL");
    }
    const { data: ready, error: readyError } = await supabase
      .from("assets")
      .update({
        status: "ready",
        storage_path: path,
        public_url: null,
        content_item_id: linkedContentItemId,
      })
      .eq("id", assetId)
      .select(
        "id, workspace_id, content_item_id, status, storage_path, public_url, filename, mime_type, created_at, updated_at",
      )
      .single();
    if (readyError || !ready) {
      await supabase.storage.from("generated-assets").remove([path]);
      await supabase
        .from("assets")
        .update({
          status: "persistence_failed",
          metadata: { persistence_error: errorMessage(readyError) },
        })
        .eq("id", assetId);
      return jsonError(
        500,
        `Asset storage succeeded but metadata could not be finalized: ${errorMessage(readyError)}`,
      );
    }

    if (linkedContentItemId) {
      const { data: currentContent } = await supabase
        .from("content_items")
        .select("meta")
        .eq("id", linkedContentItemId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const { error: contentUpdateError } = await supabase
        .from("content_items")
        .update({
          // Keep the durable Storage path in metadata. The signed URL is only a
          // response presentation value and must not become persistent identity.
          media_url: null,
          meta: {
            ...(currentContent?.meta && typeof currentContent.meta === "object"
              ? currentContent.meta
              : {}),
            asset_id: assetId,
            asset_storage_path: path,
            asset_status: "ready",
          },
        })
        .eq("id", linkedContentItemId)
        .eq("workspace_id", workspaceId);
      if (contentUpdateError) {
        console.warn(
          "Asset persisted but post link update failed",
          errorMessage(contentUpdateError),
        );
      }
    }
    return Response.json({
      asset: { ...ready, public_url: signedFile.signedUrl },
      deduplicated: false,
    });
  },
});
