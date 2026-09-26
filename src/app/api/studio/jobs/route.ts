import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { CreateJobSchema } from "@/lib/studio/jobs";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { createStudioJob, listJobs, StudioJobError } from "@/server/studio/runner.server";
import { runMetered, type MeteredAction } from "@/server/billing/metered.server";
import { getEntitlements } from "@/server/billing/entitlements.server";
import { HttpError } from "@/server/http-error";

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
  handler: async ({ body, workspaceId, userId, role, supabase }) => {
    try {
      // Renders settle asynchronously. Phase 3 adds holds that stay live until
      // the provider callback; never capture them at job submission in on mode.
      const renders =
        body.type === "video" ||
        body.type === "image" ||
        body.type === "ad" ||
        ((body.type === "social" || body.type === "carousel") && body.controls.includeImage);
      if (renders) {
        const entitlements = await getEntitlements({ userId, workspaceId, role });
        if (entitlements.enforcement === "on") {
          throw new HttpError(503, "Render billing is being prepared. Please try again shortly.");
        }
      }
      const action: MeteredAction =
        body.type === "video"
          ? "studio_video"
          : body.type === "image"
            ? "image_post"
            : body.type === "carousel"
              ? "carousel"
              : body.type === "ad"
                ? "ad_set"
                : body.type === "script"
                  ? "script"
                  : body.type === "article"
                    ? body.controls.length === "long"
                      ? "article_long"
                      : "article_standard"
                    : body.controls.includeImage
                      ? "image_post"
                      : body.regenerate || body.parentJobId
                        ? "post_regenerate"
                        : "post_set";
      const billingRoute = {
        social: "studio.social",
        image: "studio.captions",
        carousel: "studio.carousel",
        video: "video",
        article: "studio.article",
        script: "studio.script",
        ad: "studio.ad",
      }[body.type];
      const metered = await runMetered(
        {
          workspaceId,
          userId,
          role,
          action,
          idempotencyKey: body.idempotencyKey,
          route: billingRoute,
        },
        async (charge) => {
          const job = await createStudioJob({ client: supabase, workspaceId, userId, input: body });
          if (job.status !== "succeeded") charge.setCapturedAmount(0);
          return job;
        },
      );
      return Response.json(
        { job: metered.result },
        metered.balance === null
          ? undefined
          : { headers: { "X-Billing-Balance": String(metered.balance) } },
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
