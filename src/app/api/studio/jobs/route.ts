import { z } from "zod";
import { studioChargeFor } from "@/lib/studio/billing";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { CreateJobSchema } from "@/lib/studio/jobs";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { createStudioJob, listJobs, StudioJobError } from "@/server/studio/runner.server";
import {
  beginDeferredMetered,
  runMetered,
  type MeteredAction,
} from "@/server/billing/metered.server";
import {
  CREDIT_ACTIONS,
  STUDIO_VIDEO_UNITS,
  creditsFor,
  type CreditAction,
} from "@/lib/billing/catalog";
import { saveStudioBillingLink } from "@/server/billing/studio-async.server";
import { runWithScope } from "@/server/request-context";

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
      const media = STUDIO_FORMATS[body.type].media;
      const renders =
        media === "video" ||
        media === "image" ||
        (media === "optional-image" && body.controls.includeImage);
      const action: MeteredAction = studioChargeFor({
        type: body.type,
        includeImage: body.controls.includeImage,
        length: body.controls.length,
        regenerate: Boolean(body.regenerate || body.parentJobId),
      });
      const billingRoute = {
        social: "studio.social",
        image: "studio.captions",
        carousel: "studio.carousel",
        video: "video",
        article: "studio.article",
        script: "studio.script",
        ad: "studio.ad",
      }[body.type];
      if (renders) {
        const video = action === "studio_video";
        const amount = video ? STUDIO_VIDEO_UNITS : creditsFor(action as CreditAction);
        const charge = await beginDeferredMetered({
          workspaceId,
          userId,
          role,
          actionName: action as string,
          meter: video ? "video" : "credits",
          amount,
          feature: video ? "ugc" : CREDIT_ACTIONS[action as CreditAction].feature,
          idempotencyKey: body.idempotencyKey,
          route: billingRoute,
          expiresAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
        });
        let job;
        try {
          job = await runWithScope(
            { billingAccountId: charge.accountId, billingChargeId: charge.chargeId ?? undefined },
            () =>
              createStudioJob({
                client: supabase,
                workspaceId,
                userId,
                input: body,
                onCreated: async (created) =>
                  charge.mode === "off"
                    ? undefined
                    : saveStudioBillingLink({
                        job_id: created.id,
                        account_id: charge.accountId,
                        workspace_id: workspaceId,
                        hold_id: charge.holdId,
                        charge_id: charge.chargeId,
                        charge_key: `${userId}:${action}:${body.idempotencyKey}`,
                        action: action as string,
                        meter: video ? "video" : "credits",
                        amount,
                        route: billingRoute,
                        mode: charge.mode,
                        shadow_decision: charge.shadowDecision,
                      }),
              }),
          );
        } catch (error) {
          await charge.release();
          throw error;
        }
        if (job.status === "succeeded") {
          await charge.capture();
        } else if (job.status !== "running" && job.status !== "queued") {
          await charge.release();
        }
        return { job };
      }
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
