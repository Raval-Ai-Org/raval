import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { signStoragePath } from "@/server/assets/storage.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "assets/download",
  auth: "workspace",
  body: z.object({
    workspaceId: z.string().uuid(),
    path: z.string().min(1).max(500),
    filename: z.string().min(1).max(160),
  }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId, supabase }) => {
    if (!isWorkspaceStoragePath(body.path, workspaceId)) {
      return jsonError(403, "This asset is outside the workspace");
    }
    const filename = body.filename.replace(/[^a-z0-9._-]/gi, "_");
    const url = await signStoragePath(supabase, body.path, 300, filename);
    if (!url) return jsonError(404, "The stored asset was not found");
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  },
});
