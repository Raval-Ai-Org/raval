import { z } from "zod";
import { jsonError, UUID_RE } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { chooseStudioVariation, StudioJobError } from "@/server/studio/runner.server";

export const dynamic = "force-dynamic";

/** Make one of a job's versions the post's picture. Free: nothing is rendered. */
export const POST = defineRoute({
  name: "studio/jobs:choose",
  auth: "workspace",
  minRole: "editor",
  body: z.object({
    workspaceId: z.string().uuid(),
    slot: z.string().regex(/^option:[0-9]$/),
  }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ request, body, workspaceId, supabase }) => {
    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    const id = parts[parts.indexOf("jobs") + 1];
    if (!id || !UUID_RE.test(id)) return jsonError(400, "Invalid job id");
    try {
      return { job: await chooseStudioVariation(supabase, workspaceId, id, body.slot) };
    } catch (error) {
      if (error instanceof StudioJobError) return jsonError(error.status, error.message);
      throw error;
    }
  },
});
