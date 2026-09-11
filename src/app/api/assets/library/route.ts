import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({ workspaceId: z.string().trim().min(1) });

function normalizeAsset(row: Record<string, unknown>, signedUrls: Map<string, string>) {
  const storagePath = typeof row.storage_path === "string" ? row.storage_path : null;
  const url = (storagePath && signedUrls.get(storagePath)) ?? null;
  return {
    id: String(row.id),
    type: String(row.asset_type ?? "file"),
    name: String(row.filename ?? "Generated asset"),
    storagePath,
    url,
    thumbnailUrl: typeof row.thumbnail_path === "string" ? row.thumbnail_path : url,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    workspaceId: String(row.workspace_id),
    postId: typeof row.content_item_id === "string" ? row.content_item_id : null,
    status: String(row.status ?? "ready"),
    platform: typeof row.platform === "string" ? row.platform : null,
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}

// Membership is enforced by the kernel; every query below also runs through
// the caller's RLS-bound client.
export const GET = defineRoute({
  name: "assets/library",
  auth: "workspace",
  query: QuerySchema,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async (ctx) => {
    const { workspaceId } = ctx;
    // `assets` is missing from the generated Database types
    // (src/integrations/supabase/types.ts predates it), so this route queries
    // through an untyped view of the same RLS-bound client.
    const supabase = ctx.supabase as unknown as SupabaseClient;

    const { data: rows, error: assetsError } = await supabase
      .from("assets")
      .select(
        "id, filename, public_url, storage_path, thumbnail_path, asset_type, status, created_at, updated_at, platform, mime_type, metadata, workspace_id, content_item_id",
      )
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (assetsError) return jsonError(500, assetsError.message);

    const storagePaths = (rows ?? [])
      .map((row) => row.storage_path)
      .filter((path): path is string => typeof path === "string");
    const { data: signedRows } = storagePaths.length
      ? await supabase.storage.from("generated-assets").createSignedUrls(storagePaths, 3600)
      : { data: [] };
    const signedUrls = new Map<string, string>();
    for (const row of signedRows ?? []) {
      if (row.path && row.signedUrl) signedUrls.set(row.path, row.signedUrl);
    }
    const assets = (rows ?? []).map((row) =>
      normalizeAsset(row as Record<string, unknown>, signedUrls),
    );
    const visible = assets.filter((asset) => Boolean(asset.url));

    // Legacy compatibility: preserve older generated media until backfill is complete.
    const { data: contentRows } = await supabase
      .from("content_items")
      .select(
        "id, title, media_url, kind, status, created_at, updated_at, channel, meta, workspace_id",
      )
      .eq("workspace_id", workspaceId)
      .not("media_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    const knownUrls = new Set(visible.map((asset) => asset.url));
    const legacy = (contentRows ?? [])
      .filter((row) => row.media_url && !knownUrls.has(row.media_url))
      .map((row) => ({
        id: row.id,
        type: row.kind === "video" ? "video" : "image",
        name: row.title || "Generated post image",
        storagePath: null,
        url: row.media_url,
        thumbnailUrl: row.media_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        workspaceId: row.workspace_id,
        postId: row.id,
        status: row.status,
        platform: row.channel,
        mimeType: null,
        metadata: row.meta ?? {},
      }));

    return Response.json(
      {
        assets: [...visible, ...legacy],
        diagnostic:
          process.env.NODE_ENV !== "production"
            ? {
                databaseAssets: rows?.length ?? 0,
                accessibleAssets: visible.length,
                legacyMedia: legacy.length,
                returnedAssets: visible.length + legacy.length,
              }
            : undefined,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
});
