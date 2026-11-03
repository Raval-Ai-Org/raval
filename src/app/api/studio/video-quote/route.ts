import { z } from "zod";
import { defineRoute } from "@/server/route";
import { ControlsSchema } from "@/lib/studio/jobs";
import { quoteStudioVideo } from "@/server/studio/video-quote.server";
import { requireBillingFeature } from "@/server/billing/feature.server";
import { getEntitlements } from "@/server/billing/entitlements.server";
import { PLANS } from "@/lib/billing/catalog";
import { freeVideosLeft } from "@/lib/billing/video-charge";
import { settleVideoControls } from "@/lib/studio/video/settle";

export const POST = defineRoute({
  name: "studio/video-quote",
  auth: "workspace",
  minRole: "editor",
  rateLimit: "generate",
  body: z.object({
    workspaceId: z.string().uuid(),
    controls: ControlsSchema,
    // What Auto picks the kind from; the same inputs createBilledStudioJob settles with.
    brief: z.string().max(10_000).optional(),
    template: z.string().max(120).optional(),
    source: z
      .object({ picture: z.boolean().optional(), script: z.boolean().optional() })
      .optional(),
  }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId, userId, role }) => {
    // The same settling createBilledStudioJob does, so the quote is for what runs.
    const controls = settleVideoControls({
      type: body.controls.storyMode === "video" ? "story" : "video",
      controls: body.controls,
      brief: body.brief,
      template: body.template,
      source: { ...body.source, product: Boolean(body.controls.productId) },
    });
    // One of the month's free or premium videos while one is left, otherwise credits.
    const entitlements = await getEntitlements({ workspaceId, userId, role });
    const quote = quoteStudioVideo(controls, {
      videoBalance: entitlements.meters.video.available,
      premiumBalance: entitlements.meters.premium_video.available,
    });
    await requireBillingFeature({
      workspaceId,
      userId,
      role,
      feature: quote.feature,
      spending: true,
    });
    return {
      hash: quote.hash,
      units: quote.units,
      meter: quote.meter,
      freeLeft: quote.freeLeft,
      freeMonthly: freeVideosLeft(PLANS[entitlements.entitledPlan].allowances.videoUnits),
      premiumLeft: quote.premiumLeft,
      premiumMonthly: PLANS[entitlements.entitledPlan].allowances.premiumVideos,
      model: quote.model,
      resolution: quote.resolution,
      aspectRatio: quote.aspectRatio,
      videoKind: controls.videoKind,
      durationSec: controls.durationSec,
    };
  },
});
