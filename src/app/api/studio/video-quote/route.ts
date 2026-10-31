import { z } from "zod";
import { defineRoute } from "@/server/route";
import { ControlsSchema } from "@/lib/studio/jobs";
import { quoteStudioVideo } from "@/server/studio/video-quote.server";
import { requireBillingFeature } from "@/server/billing/feature.server";
import { settleVideoControls } from "@/lib/studio/video/settle";

export const POST = defineRoute({
  name: "studio/video-quote",
  auth: "workspace",
  minRole: "editor",
  rateLimit: "generate",
  body: z.object({ workspaceId: z.string().uuid(), controls: ControlsSchema }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId, userId, role }) => {
    // The same settling createBilledStudioJob does, so the quote is for what runs.
    const controls = settleVideoControls({
      type: body.controls.storyMode === "video" ? "story" : "video",
      controls: body.controls,
    });
    const quote = quoteStudioVideo(controls);
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
      model: quote.model,
      resolution: quote.resolution,
      aspectRatio: quote.aspectRatio,
      videoKind: controls.videoKind,
      durationSec: controls.durationSec,
    };
  },
});
