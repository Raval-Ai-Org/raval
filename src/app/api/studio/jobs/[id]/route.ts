import { z } from "zod";
import { jsonError, UUID_RE } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { advanceStudioJob, getJobRow, presentJob } from "@/server/studio/runner.server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

function jobIdFrom(request: Request): string | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const id = parts[parts.indexOf("jobs") + 1];
  return id && UUID_RE.test(id) ? id : null;
}

/**
 * Read a job. While a render is in flight this also checks the provider once
 * and, when the render has finished, stores the asset — polling is what moves
 * a job forward, so no request ever waits on a render.
 */
export const GET = defineRoute({
  name: "studio/jobs:get",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().uuid() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ request, workspaceId, supabase }) => {
    const id = jobIdFrom(request);
    if (!id) return jsonError(400, "Invalid job id");
    const row = await getJobRow(supabase, workspaceId, id);
    if (!row) return jsonError(404, "Job not found");
    const advanced = await advanceStudioJob(supabase, row);
    return { job: await presentJob(advanced) };
  },
});
