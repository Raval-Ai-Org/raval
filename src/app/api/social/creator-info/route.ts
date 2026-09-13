// GET /api/social/creator-info — TikTok's per-creator audience options. TikTok
// forbids a client-chosen default privacy level, so the Studio asks the user to
// pick one of these before sending a TikTok post.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { creatorInfoHandler } from "@/lib/socialapi/handlers";
import { withSocialApi } from "@/lib/socialapi/route.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "social/creator-info",
  auth: "workspace",
  query: z.object({ workspaceId: z.string(), accountId: z.string().min(1).max(200) }),
  workspaceId: ({ query }) => query.workspaceId,
  minRole: "editor",
  handler: ({ query, workspaceId }) =>
    withSocialApi(workspaceId, (deps) => creatorInfoHandler({ accountId: query.accountId }, deps)),
});
