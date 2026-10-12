import { z } from "zod";
import { defineRoute } from "@/server/route";
import { jsonError } from "@/server/api-auth";
import { MAX_ASSET_BYTES, persistAsset } from "@/server/assets/persist.server";
import { matchesMediaType } from "@/server/assets/upload-validation";

export const dynamic = "force-dynamic";
export const POST = defineRoute({
  name: "assets/upload",
  auth: "workspace",
  minRole: "editor",
  rateLimit: "generate",
  query: z.object({
    workspaceId: z.string().uuid(),
    requestId: z.string().uuid(),
    filename: z.string().max(200),
  }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ request, query, workspaceId }) => {
    const mimeType = request.headers.get("content-type")?.split(";")[0] ?? "";
    if (
      ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
        "video/quicktime",
      ].includes(mimeType)
    )
      return jsonError(415, "Unsupported media type");
    if (Number(request.headers.get("content-length")) > MAX_ASSET_BYTES)
      return jsonError(413, "Media must be under 50 MB");
    const reader = request.body?.getReader();
    if (!reader) return jsonError(400, "Media is required");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_ASSET_BYTES) {
          await reader.cancel();
          return jsonError(413, "Media must be under 50 MB");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    if (!matchesMediaType(bytes, mimeType))
      return jsonError(415, "Media does not match its file type");
    const result = await persistAsset({
      workspaceId,
      idempotencyKey: `upload:${query.requestId}`,
      bytes,
      preserveBytes: true,
      mimeType,
      filename: query.filename,
      assetType: mimeType.startsWith("video/") ? "video" : "image",
      provider: "user-upload",
    });
    if (!result.ok) return jsonError(result.status, result.message);
    return Response.json(
      { asset: result.asset, deduplicated: result.deduplicated },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
});
