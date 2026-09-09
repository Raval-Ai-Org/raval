import { createClient } from "@supabase/supabase-js";
import { assertPublicUrl, jsonError, requireUserId } from "@/server/api-auth";

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

function userSupabase(request: Request) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const authorization = request.headers.get("authorization");
  if (!url || !key || !authorization) throw new Error("Server not configured");
  return createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serviceSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid persistence request");
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const contentItemId = typeof body.contentItemId === "string" ? body.contentItemId : null;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
  const assetType = body.assetType === "video" ? "video" : "image";
  if (
    !UUID_RE.test(workspaceId) ||
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
      const source = assertPublicUrl(sourceUrl);
      const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return jsonError(502, "Generated asset could not be downloaded");
      mimeType =
        mimeType ||
        response.headers.get("content-type")?.split(";")[0] ||
        "application/octet-stream";
      bytes = Buffer.from(await response.arrayBuffer());
    } catch {
      return jsonError(502, "Generated asset could not be downloaded");
    }
  }
  if (!bytes.length || bytes.length > 50 * 1024 * 1024)
    return jsonError(413, "Generated asset is too large");

  const userClient = userSupabase(request);
  const { data: member } = await userClient
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (!member) return jsonError(403, "You do not have access to this workspace");

  // Membership is checked with the user's session above. The actual asset and
  // Storage writes use the server-only service role so valid members are not
  // blocked by Storage RLS policy differences between environments.
  const supabase = serviceSupabase() ?? userClient;

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
  if (existing?.status === "ready" && existing.public_url)
    return Response.json({ asset: existing, deduplicated: true });

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
        typeof body.filename === "string" ? body.filename : `mellox-${idempotencyKey.slice(0, 12)}`,
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
      if (raced?.status === "ready" && raced.public_url)
        return Response.json({ asset: raced, deduplicated: true });
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

  const { data: publicFile } = supabase.storage.from("generated-assets").getPublicUrl(path);
  const { data: ready, error: readyError } = await supabase
    .from("assets")
    .update({
      status: "ready",
      storage_path: path,
      public_url: publicFile.publicUrl,
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
    const { error: contentUpdateError } = await supabase
      .from("content_items")
      .update({
        media_url: publicFile.publicUrl,
        meta: { asset_id: assetId, asset_storage_path: path, asset_status: "ready" },
      })
      .eq("id", linkedContentItemId)
      .eq("workspace_id", workspaceId);
    if (contentUpdateError) {
      console.warn("Asset persisted but post link update failed", errorMessage(contentUpdateError));
    }
  }
  return Response.json({ asset: ready, deduplicated: false });
}
