// POST /api/social/connect/complete — finish a SocialAPI.ai account connection
// from the OAuth redirect (/app/social/connected). Verifies the one-time state
// against the user + workspace that started it, confirms the account belongs to
// the workspace's brand, and mirrors it; or returns the Facebook Page choices.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { completeConnectHandler } from "@/lib/socialapi/handlers";
import { withSocialApi } from "@/lib/socialapi/route.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  workspaceId: z.string(),
  state: z.string().min(16).max(512),
  status: z.enum(["success", "error", "selection_required"]),
  accountId: z.string().max(200).nullish(),
  connectionId: z.string().max(200).nullish(),
  error: z.string().max(200).nullish(),
  errorDescription: z.string().max(1000).nullish(),
});

export const POST = defineRoute({
  name: "social/connect/complete",
  auth: "workspace",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: ({ body, workspaceId, userId }) =>
    withSocialApi(workspaceId, (deps) =>
      completeConnectHandler({ ...body, workspaceId, userId }, deps),
    ),
});
