import { z } from "zod";
import { jsonError, UUID_RE } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { cancelStudioJob, StudioJobError } from "@/server/studio/runner.server";
import { settleStudioBilling } from "@/server/billing/studio-async.server";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "studio/jobs:cancel",
  auth: "workspace",
  minRole: "editor",
  body: z.object({ workspaceId: z.string().uuid() }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ request, workspaceId, supabase }) => {
    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    const id = parts[parts.indexOf("jobs") + 1];
    if (!id || !UUID_RE.test(id)) return jsonError(400, "Invalid job id");
    try {
      const job = await cancelStudioJob(supabase, workspaceId, id);
      await settleStudioBilling(job);
      return { job };
    } catch (error) {
      if (error instanceof StudioJobError) return jsonError(error.status, error.message);
      throw error;
    }
  },
});
