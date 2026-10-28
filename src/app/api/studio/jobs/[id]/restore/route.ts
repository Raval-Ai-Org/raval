import { z } from "zod";
import { jsonError, UUID_RE } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { restoreStudioVersion, StudioJobError } from "@/server/studio/runner.server";

export const dynamic = "force-dynamic";

/** Undo an edit: put the post back to an earlier version. Free: nothing is generated. */
export const POST = defineRoute({
  name: "studio/jobs:restore",
  auth: "workspace",
  minRole: "editor",
  body: z.object({ workspaceId: z.string().uuid(), versionJobId: z.string().uuid() }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ request, body, workspaceId, supabase }) => {
    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    const id = parts[parts.indexOf("jobs") + 1];
    if (!id || !UUID_RE.test(id)) return jsonError(400, "Invalid job id");
    try {
      return {
        job: await restoreStudioVersion(supabase, workspaceId, id, body.versionJobId),
      };
    } catch (error) {
      if (error instanceof StudioJobError) return jsonError(error.status, error.message);
      throw error;
    }
  },
});
