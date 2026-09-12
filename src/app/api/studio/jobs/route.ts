import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { CreateJobSchema } from "@/lib/studio/jobs";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { createStudioJob, listJobs, StudioJobError } from "@/server/studio/runner.server";

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
      media === "video"
        ? "video"
        : media === "image" || (media === "optional-image" && body.controls.includeImage)
          ? "image"
          : null;
    // A caption-only refine never renders.
    if (body.refine && body.refine.target !== "media" && body.refine.target !== "all") {
      return { tier: "generate" };
    }
    return { tier: renders ?? "generate" };
  },
  handler: async ({ body, workspaceId, userId, supabase }) => {
    try {
      const job = await createStudioJob({ client: supabase, workspaceId, userId, input: body });
      return { job };
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
