// POST /api/social/retry — retry a failed / partially failed SocialAPI.ai
// delivery. Uses one publishing credit (plan quota enforced server-side).
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { retryHandler } from "@/lib/socialapi/handlers";
import { withSocialApi } from "@/lib/socialapi/route.server";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "social/retry",
  auth: "workspace",
  body: z.object({ workspaceId: z.string(), contentItemId: z.string().uuid() }),
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: ({ body, workspaceId, userId }) =>
    withSocialApi(workspaceId, (deps) =>
      retryHandler({ workspaceId, userId, contentItemId: body.contentItemId }, deps),
    ),
});
