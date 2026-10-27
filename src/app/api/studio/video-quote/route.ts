import { z } from "zod";
import { defineRoute } from "@/server/route";
import { ControlsSchema } from "@/lib/studio/jobs";
import { quoteStudioVideo } from "@/server/studio/video-quote.server";
import { requireBillingFeature } from "@/server/billing/feature.server";

export const POST = defineRoute({
  name: "studio/video-quote",
  auth: "workspace",
  minRole: "editor",
  rateLimit: "generate",
  body: z.object({ workspaceId: z.string().uuid(), controls: ControlsSchema }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId, userId, role }) => {
    const quote = quoteStudioVideo(body.controls);
    await requireBillingFeature({
      workspaceId,
      userId,
      role,
      feature: quote.feature,
      spending: true,
    });
    return { hash: quote.hash, units: quote.units, model: quote.model, resolution: quote.resolution, aspectRatio: quote.aspectRatio };
  },
});
