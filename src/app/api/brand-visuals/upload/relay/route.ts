import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ASSET_BUCKET, isR2AssetPath, uploadAssetObject } from "@/server/assets/storage.server";
import { inboxPath } from "@/server/brand-visuals/ingest.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, UPLOAD_MESSAGES, uploadKind } from "@/lib/inspo/uploads";

// Inspo uploads, the fallback for step two: when the browser can't send a
// file straight to storage (a network, extension or storage CORS refusal),
// it sends the same file here and the server puts it at the same inbox path.
// /finish then reads it back exactly as before.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const PUT = defineRoute({
  name: "brand-visuals/upload/relay",
  auth: "workspace",
  minRole: "editor",
  rateLimit: "upload",
  query: z.object({
    workspaceId: z.string().uuid(),
    id: z.string().uuid(),
    type: z.string().max(100),
  }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ request, query, workspaceId }) => {
    const kind = uploadKind(query.type);
    if (!kind) return jsonError(415, UPLOAD_MESSAGES.type);
    const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > limit)
      return jsonError(
        413,
        kind === "video" ? UPLOAD_MESSAGES.videoSize : UPLOAD_MESSAGES.imageSize,
      );
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length) return jsonError(400, UPLOAD_MESSAGES.empty);
    if (bytes.length > limit)
      return jsonError(
        413,
        kind === "video" ? UPLOAD_MESSAGES.videoSize : UPLOAD_MESSAGES.imageSize,
      );
    const path = inboxPath(workspaceId, query.id, query.type);
    if (!isWorkspaceStoragePath(path, workspaceId)) return jsonError(400, UPLOAD_MESSAGES.missing);
    if (isR2AssetPath(path)) {
      await uploadAssetObject(path, bytes, query.type);
    } else {
      const { error } = await supabaseAdmin.storage
        .from(ASSET_BUCKET)
        .upload(path, bytes, { contentType: query.type, upsert: true });
      if (error) return jsonError(502, UPLOAD_MESSAGES.missing);
    }
    return Response.json({ ok: true });
  },
});
