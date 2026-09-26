// POST /api/social/retry — retry a failed / partially failed SocialAPI.ai
// delivery. Plans include unlimited posts under a daily fair-use guard.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { retryHandler } from "@/lib/socialapi/handlers";
import { withSocialApi } from "@/lib/socialapi/route.server";
import { assertPublishingAction } from "@/server/billing/social-profiles.server";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "social/retry",
  auth: "workspace",
  body: z.object({ workspaceId: z.string(), contentItemId: z.string().uuid() }),
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: async ({ body, workspaceId, userId, role }) => {
    await assertPublishingAction({ workspaceId, userId, role, action: "social_retry" });
    return withSocialApi(workspaceId, (deps) =>
      retryHandler({ workspaceId, userId, contentItemId: body.contentItemId }, deps),
    );
  },
});
