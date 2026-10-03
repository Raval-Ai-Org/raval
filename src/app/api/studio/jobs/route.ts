import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { CreateJobSchema } from "@/lib/studio/jobs";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { listJobs, StudioJobError } from "@/server/studio/runner.server";
import { createBilledStudioJob, studioJobRenders } from "@/server/studio/billed.server";
import { isStoriesEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";
// Text generation runs inside this request; renders do not.
export const maxDuration = 120;

/** Start a generation (or regenerate / refine an existing one). */
export const POST = defineRoute({
  name: "studio/jobs:create",
  auth: "workspace",
  minRole: "editor",
  body: CreateJobSchema,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: ({ body }) => {
    const media = STUDIO_FORMATS[body.type].media;
    const renders =
      media === "video" || (body.type === "story" && body.controls.storyMode === "video")
        ? "video"
        : studioJobRenders(body)
          ? "image"
          : null;
    // A caption-only refine never renders.
    if (body.refine && body.refine.target !== "media" && body.refine.target !== "all") {
      return { tier: "generate" };
    }
    return { tier: renders ?? "generate" };
  },
  handler: async ({ body, workspaceId, userId, role, supabase }) => {
    if (body.type === "story" && !isStoriesEnabled(workspaceId)) {
      return jsonError(404, "Stories aren't available for this workspace.");
    }
    try {
      // Billing and the job share one path with Autopilot (billed.server.ts).
      const { job, balance } = await createBilledStudioJob({
        client: supabase,
        workspaceId,
        userId,
        role,
        input: body,
      });
      return Response.json(
        { job },
        balance === null ? undefined : { headers: { "X-Billing-Balance": String(balance) } },
      );
    } catch (error) {
      if (error instanceof StudioJobError) return jsonError(error.status, error.message);
      throw error;
    }
  },
});

/** Recent jobs (last 24h) so the rail and dock can resume after a reload. */
export const GET = defineRoute({
  name: "studio/jobs:list",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().uuid() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ workspaceId, supabase }) => ({ jobs: await listJobs(supabase, workspaceId) }),
});
