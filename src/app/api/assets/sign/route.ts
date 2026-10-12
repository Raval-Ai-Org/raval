import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { signStoragePaths } from "@/server/assets/storage.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  paths: z.array(z.string().min(1).max(500)).min(1).max(100),
});

export const POST = defineRoute({
  name: "assets/sign",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId, supabase }) => {
    if (!body.paths.every((path) => isWorkspaceStoragePath(path, workspaceId))) {
      return jsonError(403, "One or more asset paths are outside this workspace");
    }
    const signed = await signStoragePaths(supabase, body.paths, 3600);
    return Response.json(
      {
        urls: [...signed].map(([path, url]) => ({ path, url })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
});
